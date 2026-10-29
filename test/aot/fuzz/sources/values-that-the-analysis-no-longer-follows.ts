// The analysis of what flows where stops following the sets that still change once it has logged very many edges. Only a very large program comes that far, so here the number is lowered.
// A value that is no longer followed may be anything, whatever the declared type of the place it arrives at. The program prints the same.
import { family } from "../family";
import { tsconfig } from "../generators/typed-object-mutations";

const functions = `
function hide(x: unknown): any { return x }
function first(s: string): string { return s[0] }
function len(s: string): number { return s.length }
function add(n: number): number { return n + 1 }
function not(b: boolean): boolean { return !b }
interface P { x: number; y: string }
function px(p: P): number { return p.x }
function py(p: P): number { return p.y.length }
function sum(a: number[]): number { let t = 0; for (const v of a) t += v; return t }
function at(a: string[]): string { return a[0] }
function up(s: string): string { return s.toUpperCase() }
`;
const uses: Record<string, { use: string }> = {
  "an array for a string, by index": { use: `first(hide(["a"]))` },
  "an object for a string, by index": { use: `first(hide({ 0: "z" }))` },
  "an array cast to a string, by index": { use: `(hide(["a"]) as string)[0]` },
  "a number for a string, by index": { use: `first(hide(7))` },
  "an array for a string, its length": { use: `len(hide([1, 2, 3]))` },
  "a string for a number": { use: `add(hide("s"))` },
  "an object for a number": { use: `add(hide({ valueOf() { return 4 } }))` },
  "an object for a boolean": { use: `not(hide({}))` },
  "another object for an object": { use: `px(hide({ y: 1, x: "xx" })) + " " + py(hide({ y: [1, 2] }))` },
  "strings for numbers": { use: `sum(hide(["a", "b"]))` },
  "a set for an array": { use: `sum(hide(new Set([1, 2])))` },
  "a string for an array": { use: `at(hide("xyz"))` },
  "an object for a string, a method": { use: `up(hide({ toUpperCase() { return "U" } }))` },
};
const whereItStands = (use: string) =>
  `try { console.log(String(${use})) } catch (e) { console.log((e as Error).constructor.name) }`;
const inAClosure = (use: string) =>
  `function attempt(f: () => unknown) { try { console.log(String(f())) } catch (e) { console.log((e as Error).constructor.name) } }\nattempt(() => ${use})`;
const once = `for (let turn = 0; turn < (Reflect.get(globalThis, "process").argv.length > 99 ? 2 : 1); turn++)`;
const forms: Record<string, (use: string) => string> = {
  "where it stands": use => functions + whereItStands(use),
  "in a closure": use => functions + inAClosure(use),
  "all of it in a function": use => `(() => {${functions}${whereItStands(use)}\n})();`,
  "all of it in a function, in a closure": use => `(() => {${functions}${inAClosure(use)}\n})();`,
  "all of it in the body of a loop": use => `${once} {${functions}${whereItStands(use)}\n}`,
  "all of it in the body of a loop, in a closure": use => `${once} {${functions}${inAClosure(use)}\n}`,
};

export default family(
  "values that the analysis no longer follows",
  Object.entries(uses).flatMap(([name, { use }]) =>
    Object.entries(forms).map(([form, text]) => ({
      name: `${name}, ${form}.`,
      flags: ["--aot-limit=MaxValueFlowEdgesLogged:1"],
      make: () => ({ file: "main.ts", text: text(use), files: { "tsconfig.json": tsconfig } }),
    })),
  ),
);
