import { buildBothWays } from "./build-both-ways";

const makes = `build.onResolve({ filter: /^@made\\/package$/ }, (args: any) => ({ path: args.path, namespace: "made" }));
build.onLoad({ filter: /.*/, namespace: "made" }, () => ({ contents: 'export const k = "made"; export default function named() { return k; }', loader: "js" }));`;
const body = `const late = (text: string) => String((globalThis as any).nothing ?? text);
const said = (get: () => unknown) => { try { return String(get()); } catch (e: any) { return e.name + " " + e.code; } };
console.log(said(() => require.resolve({ one: "@made/package", two: "./nothing" }[late("one")]!).endsWith("package")));
console.log(said(() => require(late("@made/package")).k));
console.log(said(() => require(late("@made/other")).k));`;

// The executable without `aot` has no name for a package that a plugin makes.
const refused = "ResolveMessage MODULE_NOT_FOUND\n";
buildBothWays("compile/aot/a package that a plugin makes is not found by a require() of a name made at run time", {
  "in a CommonJS file": {
    alone: true,
    files: { "main.cts": `const made = require("@made/package");\nconsole.log(made.k);\n${body}` },
    options: `entrypoints: ["./main.cts"]`,
    plugins: [makes],
    prints: "made\n" + refused + refused + refused,
    differs: { stdout: "made\ntrue\n" + refused + refused },
  },
});
