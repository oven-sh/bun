// Times, in the binary that runs it, the parts of a walk of test/cli/lint/conformance and of the runner's rule on every name.
// usage: <bun binary> debug-cost.ts <checkout with the synced corpus>
import { readFileSync, readdirSync } from "node:fs";
import * as nodePath from "node:path";

const repo = process.argv[2];
const testRoot = nodePath.join(repo, "test");
const home = nodePath.join(testRoot, "cli", "lint", "conformance");
const sep = nodePath.sep;
const timed = <T>(label: string, run: () => T): T => {
  const started = performance.now();
  const value = run();
  const size = Array.isArray(value) ? ` (${value.length})` : "";
  console.log(`${(performance.now() - started).toFixed(0).padStart(7)} ms  ${label}${size}`);
  return value;
};

// The walks.
const walkJoin = () => {
  const files: string[] = [];
  const walk = (directory: string) => {
    for (const entry of readdirSync(nodePath.join(testRoot, directory), { withFileTypes: true })) {
      if (entry.isDirectory()) walk(nodePath.join(directory, entry.name));
      else files.push(nodePath.join(directory, entry.name));
    }
  };
  walk(nodePath.relative(testRoot, home));
  return files;
};
const walkConcat = () => {
  const files: string[] = [];
  const directories: string[] = [];
  const walk = (directory: string) => {
    directories.push(directory);
    for (const entry of readdirSync(testRoot + sep + directory, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(directory + sep + entry.name);
      else files.push(directory + sep + entry.name);
    }
  };
  walk(["cli", "lint", "conformance"].join(sep));
  return { files, directories };
};
const walkRecursive = () => {
  const prefix = ["cli", "lint", "conformance"].join(sep) + sep;
  return (readdirSync(home, { recursive: true }) as string[]).map(name => prefix + name);
};
const walkRecursiveTypes = () => {
  const files: string[] = [];
  const directories: string[] = [];
  const cut = testRoot.length + 1;
  for (const entry of readdirSync(home, { recursive: true, withFileTypes: true })) {
    const path = entry.parentPath.slice(cut) + sep + entry.name;
    if (entry.isDirectory()) directories.push(path);
    else files.push(path);
  }
  return { files, directories };
};

const viaJoin = timed("walk: readdirSync per directory, withFileTypes, names by join", walkJoin);
const { files, directories } = timed("walk: readdirSync per directory, withFileTypes, names by concatenation", () => {
  const r = walkConcat();
  return Object.assign(r.files, r);
});
const viaRecursive = timed("walk: one readdirSync recursive, plain names", walkRecursive);
const viaTypes = timed("walk: one readdirSync recursive, withFileTypes", () => {
  const r = walkRecursiveTypes();
  return Object.assign(r.files, r);
});
console.log(
  `        same files: join ${viaJoin.slice().sort().join() === files.slice().sort().join()}, recursive with types ${viaTypes.slice().sort().join() === files.slice().sort().join()}, recursive plain holds files and directories: ${viaRecursive.length} = ${files.length} + ${directories.length - 1}`,
);

// The rule, cut out of the runner and evaluated with two sets of path functions.
const source = readFileSync(nodePath.join(repo, "scripts", "runner.node.ts"), "utf8");
const predicates = ["isHidden", "isTest", "isNodeTest", "isClusterTest", "isTestStrict", "isJavaScript"];
const cut = (name: string) => {
  const found = source.match(new RegExp(`^function ${name}\\(.*?^}$`, "gms")) ?? [];
  if (found.length !== 1) throw new Error(`${found.length} functions named ${name}`);
  return found[0];
};
const code = timed("transpile the six functions", () =>
  new Bun.Transpiler({ loader: "ts" }).transformSync(predicates.map(cut).join("\n")),
);
const free = ["basename", "dirname", "sep", "isCI", "isMacOS", "isX64"];
const bind = new Function(...free, `${code}\nreturn { isTest, isHidden };`);
type Rule = Record<"isTest" | "isHidden", (path: string) => boolean>;
const native: Rule = bind(nodePath.basename, nodePath.dirname, sep, false, false, false);
// The two path functions on a path that getTests makes: names joined by the separator, no separator at an end.
const base = (path: string) => path.slice(path.lastIndexOf(sep) + 1);
const dir = (path: string) => (path.includes(sep) ? path.slice(0, path.lastIndexOf(sep)) : ".");
const plain: Rule = bind(base, dir, sep, false, false, false);

timed("22k basename of node:path", () => files.map(path => nodePath.basename(path)));
timed("22k dirname of node:path", () => files.map(path => nodePath.dirname(path)));
timed("22k basename by lastIndexOf and slice", () => files.map(base));
timed("22k dirname by lastIndexOf and slice", () => files.map(dir));
console.log(
  `        same answers: basename ${files.every(p => base(p) === nodePath.basename(p))}, dirname ${files.every(p => dir(p) === nodePath.dirname(p))}, on directories ${directories.every(p => base(p) === nodePath.basename(p) && dir(p) === nodePath.dirname(p))}`,
);
timed("isTest on every file, path functions of node:path", () => files.filter(native.isTest));
timed("isTest on every file, path functions by slice", () => files.filter(plain.isTest));
timed("isHidden on every file, path functions of node:path", () => files.filter(native.isHidden));
timed("isHidden on every file, path functions by slice", () => files.filter(plain.isHidden));
timed("isHidden on every directory and on a plain name in it, by slice", () =>
  directories.filter(d => plain.isHidden(d) || plain.isHidden(d + sep + "a")),
);
timed("isTest on every file a second time, by slice", () => files.filter(plain.isTest));

// The rule of `bun test` on every name.
const suffixes = [".test", "_test", ".spec", "_spec"];
const endings = new Set([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts"]);
timed("bun test rule, basename and extname of node:path", () =>
  files.filter(path => {
    const name = nodePath.basename(path).toLowerCase();
    const ending = nodePath.extname(name);
    return endings.has(ending) && suffixes.some(s => name.slice(0, -ending.length).endsWith(s));
  }),
);
timed("bun test rule, by slice", () =>
  files.filter(path => {
    const name = base(path).toLowerCase();
    const dot = name.lastIndexOf(".");
    return dot > 0 && endings.has(name.slice(dot)) && suffixes.some(s => name.slice(0, dot).endsWith(s));
  }),
);
timed("count of the corpus by a regular expression on the rest of the path", () => {
  const prefix = ["cli", "lint", "conformance", "corpus"].join(sep) + sep;
  return files.filter(path => path.startsWith(prefix) && !/^\.[^\\/]*$/.test(path.slice(prefix.length)));
});
