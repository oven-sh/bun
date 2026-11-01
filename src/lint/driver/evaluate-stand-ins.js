// The rules of typescript-eslint are built in, and to load them is to load TypeScript: 800 modules, 13 MB, more time than it takes to
// lint most projects. A configuration wants the lists of rules of the package, which are small modules of their own. So the large
// ones get a stand-in when they are first asked for. Whoever touches a stand-in gets what it stands for, loaded then: what the
// configuration evaluates to is the same, whatever the package looks like inside.
const large =
  /^(.*[\\/]node_modules[\\/](typescript|@typescript-eslint[\\/](?:typescript-estree|scope-manager|eslint-plugin)))[\\/](?:lib[\\/]typescript|dist[\\/](?:rules[\\/])?index)\.js$/;
// The version of the package that the module at `file` is of, if it is one of these, of a version whose insides are known.
function knownVersion(file) {
  const [, root, name] = large.exec(file) ?? [];
  if (root === undefined || /eslint-plugin$/.test(name) !== /rules[\\/]index\.js$/.test(file)) return undefined;
  try {
    const { version } = JSON.parse(fs.readFileSync(resolve(root, "package.json"), "utf8"));
    return (name === "typescript" ? /^[456]\.\d+\./ : /^8\./).test(version) ? version : undefined;
  } catch {
    return undefined;
  }
}
// `known`: what it answers for a key without being touched, if not `undefined`.
function standIn(load, known = () => undefined) {
  let real;
  const touch = () => {
    if (untouched.delete(proxy)) real = load();
    return real;
  };
  const traps = {
    get: (_, key) => known(key) ?? (isLooking && untouched.has(proxy) ? undefined : touch()[key]),
    // A proxy may not say that a property cannot be configured which its target has not.
    getOwnPropertyDescriptor(_, key) {
      const found = Reflect.getOwnPropertyDescriptor(touch(), key);
      return found && { ...found, configurable: true };
    },
    isExtensible: () => true,
  };
  for (const name of ["has", "ownKeys", "set", "deleteProperty", "defineProperty", "getPrototypeOf"]) {
    traps[name] = (_, ...rest) => Reflect[name](touch(), ...rest.slice(0, 2));
  }
  const proxy = new Proxy({}, traps);
  untouched.add(proxy);
  return proxy;
}

const handedOn = ["clearCaches", "createProgram", "withoutProjectParserOptions"];

function standInForModule(file, version) {
  let real;
  // Where typescript-eslint is to look for a tsconfig.json: it notes that whenever one of its configurations is read.
  const noted = [];
  const load = () => {
    if (real === undefined) {
      // An `import` has put the module itself there.
      if (require.cache[file]?.exports === module) delete require.cache[file];
      real = require(file);
      for (const args of noted) real.addCandidateTSConfigRootDir(...args);
    }
    return real;
  };
  const inner = standIn(() => (load().__esModule ? load().default : load()));
  const module = standIn(load, key => {
    // What TypeScript makes of an `import` asks for these two.
    if (key === "__esModule") return true;
    if (key === "default") return inner;
    if (real !== undefined) return undefined;
    // typescript-eslint makes sure of the version of TypeScript as soon as it is loaded.
    if (/typescript\.js$/.test(file)) return key === "versionMajorMinor" ? /^\d+\.\d+/.exec(version)[0] : undefined;
    if (key === "addCandidateTSConfigRootDir") return (...args) => void noted.push(args);
    // What the parser hands on. It is asked what it consists of.
    if (handedOn.includes(key)) return (...args) => load()[key](...args);
  });
  return module;
}

const Module = require("node:module");
const resolveFilename = Module._resolveFilename;
const resolved = new Set();
Module._resolveFilename = function (...args) {
  const file = Reflect.apply(resolveFilename, this, args);
  const version = resolved.has(file) || file in require.cache ? undefined : knownVersion(file);
  if (version !== undefined) {
    require.cache[file] = { id: file, filename: file, loaded: true, exports: standInForModule(file, version) };
  }
  resolved.add(file);
  return file;
};
