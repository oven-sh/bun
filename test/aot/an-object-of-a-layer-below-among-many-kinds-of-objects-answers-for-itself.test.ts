// A function of one layer takes a union of six types, and the objects come from its own layer and from the layer below. Where eight or more kinds of objects meet, the
// compiler asks one kind what a name is and lets the kinds like it answer the same. An object of the layer below answered like this layer's own: `p.missing = 3; p.missing`
// was undefined. A Bun with assertions stopped the build.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(240_000);

const kinds = [0, 1, 2, 3, 4, 5];
const files = {
  "package.json": `{ "name": "many-kinds-of-objects", "type": "module" }`,
  "tsconfig.json": `{ "compilerOptions": { "strict": true, "module": "esnext", "moduleResolution": "bundler", "target": "esnext" } }`,
  "src/lower.ts": `
    ${kinds.map(kind => `export type P${kind} = { x: number; y: number; label: string; k${kind}: number };`).join("\n")}
    export type Any = ${kinds.map(kind => `P${kind}`).join(" | ")};
    ${kinds.map(kind => `export function make${kind}(x: number): P${kind} { return { x, y: x + 1, label: "p" + x, k${kind}: ${kind} }; }`).join("\n")}
    export function sumBelow(p: Any): number { return p.x + p.y; }
    export function labelBelow(p: Any): string { return p.label + "!"; }
    export function storeBelow(p: Any, x: number): void { p.x = x; }
    export function totalBelow(points: Any[]): number { let all = 0; for (const p of points) all += p.x * 2 + p.y; return all; }`,
  "src/upper.ts": `
    import type { Any, ${kinds.map(kind => `P${kind}`).join(", ")} } from "./lower";
    ${kinds.map(kind => `export function own${kind}(x: number): P${kind} { return { x, y: -${kind + 1}, label: "o${kind}", k${kind}: ${kind + 10} }; }`).join("\n")}
    export function sum(p: Any): number { return p.x + p.y; }
    export function store(p: Any, x: number): void { p.x = x; }
    export function storeLabel(p: Any, label: string): void { p.label = label; }
    export function add(p: Any, by: number): number { p.x += by; return p.x; }
    export function storeWithoutTypes(p: any, value: any): void { p.x = value; p.y = value; }
    export function missing(p: Any): string { return String((p as any).missing) + " " + ("missing" in p) + " " + Object.hasOwn(p, "missing"); }
    export function inherited(p: Any): string { return typeof (p as any).toString + " " + typeof (p as any).hasOwnProperty + " " + ("toString" in p) + " " + String((p as any).extra); }
    export function called(p: Any): string { return (p as any).toString(); }
    export function storeMissing(p: Any, value: number): string { (p as any).missing = value; return String((p as any).missing); }
    export function define(p: Any): string { Object.defineProperty(p, "x", { value: 77, writable: true, enumerable: true, configurable: true }); return String(p.x); }`,
  "objects.test.ts": `
    import { test } from "bun:test";
    import * as lower from "./src/lower";
    import * as upper from "./src/upper";
    const say = (...words: unknown[]) => console.log("SAID " + words.map(word => { try { return String(word); } catch (error) { return "threw"; } }).join(" "));
    const told = (ask: () => unknown) => { try { return ask(); } catch (error: any) { return error.name + ": " + error.message; } };
    const makers: ((x: number) => lower.Any)[] = [${kinds.map(kind => `upper.own${kind}`).join(", ")}, ${kinds.map(kind => `lower.make${kind}`).join(", ")}];
    const every = (p: any) => [upper.sum(p), upper.missing(p), upper.inherited(p), told(() => upper.called(p)), lower.sumBelow(p), lower.labelBelow(p), JSON.stringify(p)].join(" | ");
    test("as they are made", () => { for (const make of makers) say("made", every(make(1))); });
    test("stores", () => {
      for (const make of makers) {
        const p = make(1);
        upper.store(p, 7); say("stored", every(p));
        upper.store(p, 1.5); say("fraction", every(p));
        upper.storeLabel(p, "new"); say("label", every(p));
        say("added", upper.add(p, 2), upper.add(p, 0.25), every(p));
        lower.storeBelow(p, 3); say("below", every(p), lower.totalBelow([p, p]));
        for (const value of ["text", undefined, null, true, { a: 1 }]) {
          const q = make(1);
          upper.storeWithoutTypes(q, value);
          say("any", told(() => lower.sumBelow(q)), told(() => upper.sum(q)), told(() => JSON.stringify(q)), told(() => lower.totalBelow([q])));
          lower.storeBelow(q, 4); say("back", every(q));
        }
      }
    });
    test("what changes an object", () => {
      for (const make of makers) {
        let p: any = make(1); Object.setPrototypeOf(p, { missing: "above", extra: 6, toString() { return "mine"; } }); say("prototype", every(p));
        p = make(1); Object.setPrototypeOf(p, null); say("none", told(() => every(p)));
        p = make(1); Object.defineProperty(p, "x", { get() { return 40; }, set(v) { say("setter", v); }, enumerable: true, configurable: true }); upper.store(p, 9); say("accessor", every(p));
        p = make(1); Object.freeze(p); say("frozen", told(() => upper.store(p, 9)), every(p));
        p = make(1); delete p.x; upper.store(p, 8); say("again", every(p));
        p = make(1); say("defined", upper.define(p), every(p));
        p = make(1); say("stored a new name", upper.storeMissing(p, 3), JSON.stringify(p));
        p = make(1); Object.setPrototypeOf(p, { set missing(v: number) { say("setter of the new name", v); } }); say("setter of a new name", upper.storeMissing(p, 3), Object.hasOwn(p, "missing"));
        p = make(1); Object.preventExtensions(p); say("closed", told(() => upper.storeMissing(p, 3)), every(p));
        p = make(1); Object.setPrototypeOf(p, { set x(v: number) { say("setter above", v); } }); delete p.x; upper.store(p, 8); say("setter", Object.hasOwn(p, "x"));
      }
    });`,
};

async function runIn(words: string | undefined, ...flags: string[]) {
  using dir = tempDir("aot-many-kinds-of-objects", files);
  const env = { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words };
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--isolate", ...flags], String(dir), env);
  const failed = stderr.split("\n").filter(line => /^\(fail\)|^✗|^panic|^error|^ASSERTION/.test(line));
  return { said: stdout.split("\n").filter(line => line.startsWith("SAID")), failed, exitCode };
}

test("it says what plain Bun says as one program, in two layers and with a border between the two files", async () => {
  const [plain, one, two, three] = await Promise.all([
    runIn(undefined),
    runIn("TestRunLayers:0", "--aot"),
    runIn("TestRunLayers:2,TestRunPartFiles:1", "--aot"),
    runIn("TestRunLayers:3,TestRunPartFiles:1", "--aot"),
  ]);
  expect(plain.said.length).toBeGreaterThan(340);
  expect(plain).toEqual({ said: plain.said, failed: [], exitCode: 0 });
  expect(one).toEqual(plain);
  expect(two).toEqual(plain);
  expect(three).toEqual(plain);
});
