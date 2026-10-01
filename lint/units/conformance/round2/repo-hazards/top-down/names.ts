// usage: bun names.ts <runner.node.ts> <list of paths from the root of the repository>
// Applies the predicates of the runner, cut out of its source, to every path. Prints counts.
import { readFileSync } from "node:fs";
import * as path from "node:path";

const [runnerFile, listFile] = process.argv.slice(2);
const source = readFileSync(runnerFile, "utf8");
const names = ["isJavaScript", "isJavaScriptTest", "isNodeTest", "isClusterTest", "isTest", "isTestStrict", "isHidden"];
const cut = (name: string) => {
  const found = [...source.matchAll(new RegExp(`^function ${name}\\([^]*?^}$`, "gm"))];
  if (found.length !== 1) throw new Error(`${found.length} functions named ${name}`);
  return found[0][0];
};
const code = new Bun.Transpiler({ loader: "ts" }).transformSync(names.map(cut).join("\n"));
const bind = (p: typeof path.posix) =>
  new Function("basename", "dirname", "sep", "isCI", "isMacOS", "isX64", `${code}\nreturn { ${names.join(", ")} };`)(
    p.basename,
    p.dirname,
    p.sep,
    false,
    false,
    false,
  ) as Record<string, (p: string) => boolean>;
const posix = bind(path.posix);
const win32 = bind(path.win32);

const all = readFileSync(listFile, "utf8").split("\n").filter(Boolean);
const count: Record<string, number> = {};
const hits: Record<string, string[]> = {};
const add = (k: string, p: string) => {
  count[k] = (count[k] ?? 0) + 1;
  (hits[k] ??= []).push(p);
};
for (const full of all) {
  const rel = full.slice("test/".length);
  for (const [form, p] of [
    ["below test/", rel],
    ["from the root", full],
  ] as const) {
    for (const name of names) {
      if (posix[name](p)) add(`posix ${name} (${form})`, p);
      if (win32[name](p.replaceAll("/", "\\"))) add(`win32 ${name} (${form})`, p);
    }
  }
  // isHidden as getTests applies it: to every prefix of the path below test/.
  const parts = rel.split("/");
  for (let i = 1; i <= parts.length; i++) {
    if (posix.isHidden(parts.slice(0, i).join("/"))) {
      add("hidden on the walk (a prefix is hidden)", full);
      break;
    }
  }
}
console.log(`${all.length} paths`);
for (const k of Object.keys(count).sort()) {
  console.log(`${String(count[k]).padStart(6)}  ${k}${count[k] <= 12 ? `: ${hits[k].join(" ")}` : ""}`);
}
// The rule of `bun test`: lowered base name, a JavaScript-like extension, one of four suffixes before it.
const js = new Set([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts"]);
const bunTakes = (p: string) => {
  const base = path.posix.basename(p).toLowerCase();
  const ext = path.posix.extname(base);
  return js.has(ext) && [".test", "_test", ".spec", "_spec"].some(s => base.slice(0, -ext.length).endsWith(s));
};
console.log(`${String(all.filter(bunTakes).length).padStart(6)}  bun test (model)`);
const loose = all.filter(p => /\.test|spec\.|_test\./i.test(path.posix.basename(p)));
console.log(`${String(loose.length).padStart(6)}  base names with .test, spec. or _test. in any case: ${loose.slice(0, 20).join(" ")}`);
const dirs = all.filter(p => /js\/node\/test\/(parallel|sequential)\/|js\/bun\/test\/parallel\/|js\/node\/cluster\/test-/.test(p));
console.log(`${String(dirs.length).padStart(6)}  paths below a directory of isNodeTest or isClusterTest`);
console.log(`${String(all.filter(p => p.endsWith(".d.ts")).length).padStart(6)}  *.d.ts`);
const exts: Record<string, number> = {};
for (const p of all) {
  const e = path.posix.extname(p) || "(none)";
  exts[e] = (exts[e] ?? 0) + 1;
}
console.log(Object.entries(exts).sort((a, b) => b[1] - a[1]).map(([e, n]) => `${e} ${n}`).join(", "));
console.log(`longest path ${Math.max(...all.map(p => p.length))}`);
