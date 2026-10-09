// What the scripts that run configuration files have in common: how a value, a plugin and its rules are written as JSON.

const unserializable = what => ({ $unserializable: what });

// `name@version` of a parser, a plugin or a processor: ESLint's `getObjectId`.
function objectId(object) {
  const name = object.name ?? object.meta?.name;
  if (typeof name !== "string" || !name) return null;
  const version = object.version ?? object.meta?.version;
  return typeof version === "string" && version ? `${name}@${version}` : name;
}

// How a worker for JavaScript plugins gets hold of a plugin: `{ module, export }`, the file of a module that is loaded and
// the path to the plugin in what it exports. `null` if there is no such module: then it is where the configuration has it.
const located = new Map();
// The modules that have been looked at.
const scanned = new Set();
// What the module that is the configuration file can be called: its path as the system writes it, and that without links.
let ownNames;
// Looks at those that were loaded since the last time: a plugin can load its rules when it is asked for them.
function scan() {
  if (ownNames === undefined) {
    ownNames = [path, resolve(path)];
    try {
      ownNames.push(fs.realpathSync(path));
    } catch {
      // It is no file: a name stands in its place.
    }
  }
  for (const [module, { exports }] of Object.entries(require.cache)) {
    // What only the configuration file has is not to be had without running it.
    if (scanned.has(module) || ownNames.includes(module)) continue;
    scanned.add(module);
    const note = (value, path) => {
      if (value !== null && typeof value === "object" && !located.has(value))
        located.set(value, { module, export: path });
    };
    try {
      note(exports, []);
      // Until ESLint 8 a rule can be a function.
      if (typeof exports === "function" && !located.has(exports)) located.set(exports, { module, export: [] });
      for (const [name, value] of Object.entries(exports ?? {})) {
        note(value, [name]);
        if (name === "default") for (const [inner, it] of Object.entries(value ?? {})) note(it, [name, inner]);
      }
    } catch {}
  }
}

function locate(plugin) {
  return located.get(plugin) ?? locateWrapped(plugin);
}

// By plugin, parser or processor: what `locateDeep` has found.
const locatedDeep = new Map();

// As `locate`, also for what is further inside: `configs.recommended.plugins.x` of a package with configurations.
function locateDeep(plugin) {
  if (!locatedDeep.has(plugin)) locatedDeep.set(plugin, search(plugin));
  return locatedDeep.get(plugin);
}

function search(plugin) {
  scan();
  const found = locate(plugin);
  if (found !== null) return found;
  const pathIn = (value, depth) => {
    if (value === plugin) return [];
    if (depth === 0 || value === null || typeof value !== "object") return null;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null && !Array.isArray(value)) return null;
    for (const key of Object.keys(value)) {
      const inner = pathIn(value[key], depth - 1);
      if (inner !== null) return [key, ...inner];
    }
    return null;
  };
  for (const module of scanned) {
    // Those of plugins and of configurations, not all that these are made of.
    if (!/[\\/]node_modules[\\/](?:@[^\\/]+[\\/])?[^\\/]*eslint[^\\/]*[\\/]/.test(module)) continue;
    try {
      const inner = pathIn(require.cache[module]?.exports, 5);
      if (inner !== null) return { module, export: inner };
    } catch {}
  }
  return null;
}

// `fixupPluginRules` of the `@eslint/compat` that the configuration has loaded, if it has.
let fixupPluginRules = null;

// Where the plugin is that `fixupPluginRules` has made `plugin` of. What it adds to a rule is for an ESLint without the methods
// of ESLint 8, and the workers have these: the plugin runs as it is, and the configuration file need not be run to get at it.
function locateWrapped(plugin) {
  if (fixupPluginRules === null || !plugin?.rules) return null;
  const names = Object.keys(plugin.rules).join();
  for (const [candidate, where] of located) {
    // It answers with what it has made of a plugin before.
    if (candidate.rules && Object.keys(candidate.rules).join() === names && fixupPluginRules(candidate) === plugin) {
      wrapped.set(plugin, candidate);
      return where;
    }
  }
  return null;
}

// By what `fixupPluginRules` has made: what of.
const wrapped = new Map();

// JSON, or `undefined` for what is not.
function asJson(value) {
  try {
    return JSON.parse(stringify(value));
  } catch {
    return undefined;
  }
}

// `JSON.stringify` that keeps an infinite number, which default options have: as a number too large for a double.
function stringify(value) {
  let hasInfinity = false;
  const json = JSON.stringify(value, (_, it) => {
    if (it !== Infinity && it !== -Infinity) return it;
    hasInfinity = true;
    return it > 0 ? "\0+Infinity" : "\0-Infinity";
  });
  return hasInfinity
    ? json.replace(/"\\u0000([+-])Infinity"/g, (_, sign) => (sign === "+" ? "1e999" : "-1e999"))
    : json;
}

// What the linter has to know of a plugin before any of its rules runs, as JSON: `plugin_of` in `js_plugin/host.rs` reads it.
// The rules are in the order in which a worker numbers them. `at`: the module that exports the very rule, if there is one. A worker
// loads that, and not the plugin with all its other rules.
function describe(name, plugin) {
  const names = Object.keys(plugin.rules ?? {}).sort();
  locateDeep(plugin);
  scan();
  const original = wrapped.get(plugin) ?? plugin;
  const rules = names.map(ruleName => {
    const meta = plugin.rules[ruleName]?.meta;
    return {
      name: ruleName,
      at: locate(original.rules[ruleName]) ?? undefined,
      type: meta?.type,
      fixable: Boolean(meta?.fixable),
      hasSuggestions: meta?.hasSuggestions === true,
      schema: asJson(meta?.schema),
      defaultOptions: asJson(meta?.defaultOptions),
      deprecated: asJson(meta?.deprecated) || undefined,
      replacedBy: asJson(meta?.replacedBy),
    };
  });
  return stringify({ name, rules });
}

// A path as the system writes it, `system` being `node:path`, with `/`: that is how it is read.
function portablePath(path, system) {
  return path.split(system.sep).join("/");
}

function serialize(value, ancestors = []) {
  switch (typeof value) {
    case "string":
    case "boolean":
      return value;
    case "number":
      return Number.isFinite(value) ? value : unserializable("number");
    case "undefined":
      return undefined;
    case "object":
      break;
    default:
      return unserializable(typeof value);
  }
  if (value === null) return null;
  if (ancestors.includes(value)) return unserializable("circular");
  const inner = [...ancestors, value];
  if (Array.isArray(value)) return value.map(item => serialize(item, inner) ?? null);
  // Options of rules have them. A worker makes it again.
  if (value instanceof RegExp) return { $regexp: [value.source, value.flags] };
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return unserializable(value.constructor?.name ?? "object");
  const entries = Object.entries(value).map(([key, item]) => [key, serialize(item, inner)]);
  return Object.fromEntries(entries.filter(([, item]) => item !== undefined));
}
