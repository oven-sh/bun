import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

// `await Promise.all([import("./a.mjs"), import("./b.cjs")])`: a.mjs runs first. The loader ran a CommonJS file where it made the record of the file, steps ahead of where it runs an ES module,
// so b.cjs overtook a.mjs. Where b.cjs requires a.mjs and a.mjs calls import("./b.cjs"), that call came while b.cjs ran, and the namespace object got the names that b.cjs had exported by then.
const keys = `m => Object.keys(m).filter(k => k !== "module.exports" && k !== "__esModule").sort()`;
const programs: Record<string, { files: Record<string, string>; says: string[] }> = {
  "nothing-imported": {
    files: {
      "a.mjs": `console.log("a runs"); export const fromA = "A".toLowerCase();`,
      "b.cjs": `console.log("b runs"); exports.fromB = "B".toLowerCase();`,
      "main.mjs": `const [a, b] = await Promise.all([import("./a.mjs"), import("./b.cjs")]); console.log(a.fromA + " " + b.fromB);`,
    },
    says: ["a runs", "b runs", "a b"],
  },
  "file-requires-module": {
    files: {
      "a.mjs": `console.log("a starts"); import("./b.cjs"); export const fromA = "A".toLowerCase(); console.log("a ends");`,
      "b.cjs": `console.log("b starts"); const a = require("./a.mjs"); console.log("b sees " + a.fromA); exports.fromB = "B".toLowerCase(); console.log("b ends");`,
      "main.mjs": `const [a, b] = await Promise.all([import("./a.mjs"), import("./b.cjs")]); console.log("keys " + (${keys})(b) + " " + b.fromB);`,
    },
    says: ["a starts", "a ends", "b starts", "b sees a", "b ends", "keys default,fromB b"],
  },
  // The file is the root of one load and what a statement names in another: it runs before the names are taken.
  "named-by-a-statement-too": {
    files: {
      "a.mjs": `import { vb } from "./b.cjs"; console.log("a sees " + vb); export const va = "A".toLowerCase();`,
      "b.cjs": `console.log("b starts"); globalThis.later = () => require("./a.mjs").va; exports.vb = "B".toLowerCase(); console.log("b ends");`,
      "main.mjs": `const all = await Promise.allSettled([import("./a.mjs"), import("./b.cjs")]);
for (const one of all) console.log(one.status + " " + (one.reason ? one.reason.name : (${keys})(one.value)));
console.log("later " + later());`,
    },
    says: ["b starts", "b ends", "a sees b", "fulfilled va", "fulfilled default,vb", "later a"],
  },
  // While a require() loads a graph, every step is taken before it returns.
  "called-under-a-require": {
    files: {
      "calls.mjs": `console.log("calls begins"); import("./file.cjs").then(file => console.log("then " + (${keys})(file) + " " + file.first)); console.log("calls ends");`,
      "file.cjs": `console.log("file begins"); exports.first = 1; require("./back.mjs"); exports.first = 2; exports.count = 7; console.log("file ends");`,
      "back.mjs": `import { first } from "./file.cjs"; console.log("back " + first);`,
      "main.cjs": `console.log("main begins"); require("./calls.mjs"); console.log("main ends");`,
    },
    says: [],
  },
  // A call that finds no graph on its way overtakes nobody, and runs the file where it always did: what the body starts settles ahead of the call.
  "lone-call": {
    files: {
      "loaded.mjs": `export const loaded = 1;`,
      "root.cjs": `console.log("body"); require("./loaded.mjs"); import("./loaded.mjs").then(() => console.log("inner"));`,
      "main.mjs": `await import("./root.cjs"); console.log("outer");`,
    },
    says: [],
  },
};

for (const [name, { files, says }] of Object.entries(programs)) {
  test(
    name,
    async () => {
      using dir = tempDir("aot-commonjs-root-in-turn", files);
      const directory = String(dir);
      const entry = "main.mjs" in files ? "./main.mjs" : "./main.cjs";
      const said = async (flags: string[], outfile: string) => {
        const built = await run(
          [bunExe(), "build", "--compile", ...flags, entry, "--outfile", join(directory, outfile)],
          directory,
        );
        expect(built.exitCode).toBe(0);
        const ran = await run([join(directory, outfile)], directory, { ...bunEnv, BUN_TMPDIR: directory });
        return { lines: ran.stdout.trim().split("\n"), exitCode: ran.exitCode };
      };
      if (says.length) {
        const plain = await said([], "plain");
        expect(plain).toEqual({ lines: says, exitCode: 0 });
        expect(await said(["--aot"], "compiled")).toEqual(plain);
        return;
      }
      // Plain's --compile joins the files into one and goes another way here. `bun run` says what the loader does.
      const ran = await run([bunExe(), "run", entry], directory);
      expect(ran.exitCode).toBe(0);
      expect(await said(["--aot"], "compiled")).toEqual({ lines: ran.stdout.trim().split("\n"), exitCode: 0 });
    },
    240_000,
  );
}
