// The analysis of what flows where stops following the sets that still change once it has logged very many edges. Only a very large program comes that far, so here the number is lowered.
// A value that is no longer followed may be anything, whatever the declared type of the place it arrives at. The program prints the same.
import { generated } from "./generated/run-generated";
import { tsconfig } from "./generated/typed-object-mutations";

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
const uses: Record<string, { use: string; failsIn?: string }> = {
  "an array for a string, by index": { use: `first(hide(["a"]))`, failsIn: "where it stands" },
  "an object for a string, by index": { use: `first(hide({ 0: "z" }))`, failsIn: "where it stands" },
  "an array cast to a string, by index": { use: `(hide(["a"]) as string)[0]`, failsIn: "in a closure" },
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
const forms: Record<string, (use: string) => string> = {
  "where it stands": use =>
    `try { console.log(String(${use})) } catch (e) { console.log((e as Error).constructor.name) }`,
  "in a closure": use =>
    `function attempt(f: () => unknown) { try { console.log(String(f())) } catch (e) { console.log((e as Error).constructor.name) } }\nattempt(() => ${use})`,
};

generated(
  "values that the analysis no longer follows",
  Object.entries(uses).flatMap(([name, { use, failsIn }]) =>
    Object.entries(forms).map(([form, text]) => ({
      name: `${name}, ${form}.`,
      isAlwaysRun: failsIn !== undefined,
      isOnlyCompiled: true as const,
      flags: ["--aot-limit=MaxValueFlowEdgesLogged:1"],
      failsToday: form === failsIn ? "it prints undefined" : undefined,
      make: () => ({ file: "main.ts", text: functions + text(use), files: { "tsconfig.json": tsconfig } }),
    })),
  ),
);
