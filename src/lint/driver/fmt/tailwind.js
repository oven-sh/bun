// Prints where Tailwind CSS puts the classes of each list that it is asked about. The file at `path` has the question:
// { groups: [{ directory, config, stylesheet, lists }] }. A list is classes with a blank between them. `directory`: of the
// files that the lists are in.
//
// Which Tailwind is asked, and how, is what prettier-plugin-tailwindcss does: `getTailwindConfig`, `loadV3`, `loadV4`.

const { dirname, isAbsolute, join } = require("node:path");

const read = file => fs.readFileSync(file, "utf8");
const importDefault = async file => {
  const module = await import(pathToFileURL(file).href);
  return module.default ?? module;
};

/** What `target`, from the `exports` of a package, is for a style sheet. */
function withConditions(target) {
  if (typeof target === "string" || target == null) return target;
  if (Array.isArray(target)) return target.map(withConditions).find(it => it != null);
  for (const [condition, value] of Object.entries(target)) {
    if (condition !== "style" && condition !== "default") continue;
    const found = withConditions(value);
    if (found != null) return found;
  }
}

/** The file that `@import "<id>"` in a style sheet in the directory `base` means. */
function resolveStylesheet(id, base) {
  const orWithEnding = file => [file, `${file}.css`].find(it => fs.statSync(it, { throwIfNoEntry: false })?.isFile());
  if (id.startsWith(".") || isAbsolute(id)) {
    const file = orWithEnding(resolve(base, id));
    if (file) return file;
    throw new Error(`Can't resolve '${id}' in '${base}'`);
  }
  const [, name, rest = ""] = /^((?:@[^/]+\/)?[^/]+)(?:\/(.*))?$/.exec(id);
  for (let directory = base; ; directory = dirname(directory)) {
    const root = join(directory, "node_modules", name);
    if (fs.existsSync(join(root, "package.json"))) {
      const description = JSON.parse(read(join(root, "package.json")));
      let target;
      if (description.exports !== undefined) {
        const exports = description.exports;
        const isMap =
          typeof exports === "object" && !Array.isArray(exports) && Object.keys(exports)[0]?.startsWith(".");
        const key = rest ? `./${rest}` : ".";
        if (!isMap) target = rest ? undefined : withConditions(exports);
        else if (key in exports) target = withConditions(exports[key]);
        else {
          for (const [pattern, value] of Object.entries(exports)) {
            const [before, behind] = pattern.split("*");
            if (behind === undefined || !key.startsWith(before) || !key.endsWith(behind)) continue;
            const middle = key.slice(before.length, key.length - behind.length);
            target = withConditions(value)?.replaceAll("*", middle);
            if (target != null) break;
          }
        }
      } else target = rest || description.style || "index";
      const file = target != null && orWithEnding(join(root, target));
      if (file) return file;
    }
    if (directory === dirname(directory)) throw new Error(`Can't resolve '${id}' in '${base}'`);
  }
}

async function loadV4(tailwind, stylesheet) {
  const load = async (id, base, otherwise) => {
    try {
      return await importDefault(Bun.resolveSync(id, base));
    } catch (error) {
      console.error(`Unable to load ${id}`, error);
      return otherwise;
    }
  };
  const design = await tailwind.__unstable__loadDesignSystem(read(stylesheet), {
    base: dirname(stylesheet),
    loadModule: async (id, base, kind) => ({ base, module: await load(id, base, kind === "config" ? {} : () => {}) }),
    loadStylesheet: async (id, base) => {
      const file = resolveStylesheet(id, base);
      return { base: dirname(file), content: read(file) };
    },
    loadPlugin: id => load(id, dirname(stylesheet), () => {}),
    loadConfig: id => load(id, dirname(stylesheet), {}),
  });
  return classes => design.getClassOrder(classes);
}

const loaded = new Map();
function orderFor({ directory, config, stylesheet }) {
  let root;
  try {
    root = dirname(Bun.resolveSync("tailwindcss/package.json", directory));
  } catch {
    throw new Error(`It needs the package tailwindcss, which cannot be found from ${directory}. Install it.`);
  }
  const key = JSON.stringify([root, config, stylesheet]);
  if (!loaded.has(key)) {
    loaded.set(
      key,
      (async () => {
        const tailwind = await import(pathToFileURL(Bun.resolveSync("tailwindcss", directory)).href);
        if (!tailwind.__unstable__loadDesignSystem || (config && !config.endsWith(".css") && !stylesheet)) {
          throw new Error(`Only Tailwind CSS 4 is supported yet. ${root} is another, or \`config\` is set.`);
        }
        return loadV4(tailwind, stylesheet ?? join(root, "theme.css"));
      })(),
    );
  }
  return loaded.get(key);
}

/** Numbers that are in the order of `orders`, which are `bigint`s, and the same where those are. */
function ranks(orders) {
  const distinct = [...new Set(orders.filter(it => it !== null))].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const rank = new Map(distinct.map((it, index) => [it, index]));
  return orders.map(it => (it === null ? null : rank.get(it)));
}

const groups = [];
for (const group of JSON.parse(read(path)).groups) {
  const { lists, ...which } = group;
  try {
    const order = await orderFor(which);
    const answers = lists.map(list => [list, ranks(order(list.split(" ")).map(it => it[1]))]);
    groups.push({ ...which, ranks: Object.fromEntries(answers) });
  } catch (error) {
    groups.push({ ...which, error: String(error?.message ?? error) });
  }
}
finish({ groups });
