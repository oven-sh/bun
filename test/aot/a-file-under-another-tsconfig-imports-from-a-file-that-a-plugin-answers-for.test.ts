// `Bun.build` with `compile: { aot: true }` and without `aot`: build-both-ways.ts. loose/ has a tsconfig.json whose compiler options are not the program's.
// Its file imports from the entry point and from files for which a plugin answers JavaScript, as the plugins of Solid, Vue and Svelte do.
import { buildBothWays } from "./build-both-ways";

const erasesTypes = `build.onLoad({ filter: /\\.tsx$/ }, async (args: any) => {
  const text = await Bun.file(args.path).text();
  return { contents: new Bun.Transpiler({ loader: "tsx" }).transformSync(text), loader: "js" };
});`;
const loose = JSON.stringify({ compilerOptions: { strict: false, lib: ["ES2021"] } });
const readerOf = (specifier: string) => `import { IS_MAIN } from "${specifier}";
export const describe = (): string => (IS_MAIN ? "main" : "not main") + " " + String(IS_MAIN);`;
const entryPoint = `import { describe } from "./loose/reader";
export const IS_MAIN: boolean = import.meta.main;
console.log(IS_MAIN, describe());`;

buildBothWays("compile/aot/a file under another tsconfig imports from a file that a plugin answers for", {
  "no plugin: a constant of the entry point": {
    alone: true,
    files: { "main.ts": entryPoint, "loose/tsconfig.json": loose, "loose/reader.ts": readerOf("../main") },
    prints: "true main true\n",
  },
  "a variable and a function of such a file": {
    files: {
      "main.ts": `import { describe } from "./loose/reader";
console.log(describe());`,
      "view.tsx": `export const IS_MAIN: boolean = import.meta.main;
export function twice(count: number): number { return count * 2; }`,
      "loose/tsconfig.json": loose,
      "loose/reader.ts": `import { IS_MAIN, twice } from "../view";
export const describe = (): string => (IS_MAIN ? "main" : "not main") + " " + twice(4);`,
    },
    plugins: [erasesTypes],
    prints: "not main 8\n",
  },
  "such a file passes on a constant of the entry point": {
    alone: true,
    files: {
      "main.ts": entryPoint,
      "between.tsx": `export { IS_MAIN } from "./main";`,
      "loose/tsconfig.json": loose,
      "loose/reader.ts": readerOf("../between"),
    },
    plugins: [erasesTypes],
    prints: "true main true\n",
  },
  "the entry point is such a file": {
    alone: true,
    files: { "main.tsx": entryPoint, "loose/tsconfig.json": loose, "loose/reader.ts": readerOf("../main") },
    options: `entrypoints: ["./main.tsx"]`,
    plugins: [erasesTypes],
    prints: "true main true\n",
  },
});
