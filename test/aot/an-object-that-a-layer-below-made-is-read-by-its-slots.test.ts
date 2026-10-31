import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(240_000);

// A type of a program stands for the layouts that meet it. A program over another one counted its own layouts alone, so a type whose objects the layer below makes stood for
// any object: every read went by name and every sum through a stub, 37 times as slow as in one program. Now the records and the instances of classes of the images below
// that meet a type are among its layouts, with the slots and the shapes that their image gives them. What such an object goes through in any layer shows as it does in plain Bun.
const files = {
  "package.json": `{ "name": "objects-from-below", "type": "module" }`,
  "tsconfig.json": `{ "compilerOptions": { "strict": true, "module": "esnext", "moduleResolution": "bundler", "target": "esnext" } }`,
  "src/lower.ts": `
    export type Point = { x: number; y: number; label: string };
    export type Maybe = { id: number; note?: string };
    export type Line = { from: Point; to: Point };
    export function make(x: number): Point { return { x, y: x + 1, label: "p" + x }; }
    export function makeOtherOrder(x: number): Point { return { label: "q", y: x + 1, x }; }
    export function makeWide(x: number): Point & { z: number } { return { x, y: 0, label: "w", z: 9 }; }
    export function makeMaybe(id: number, note?: string): Maybe { return note === undefined ? { id } : { id, note }; }
    export function makeLine(x: number): Line { return { from: make(x), to: make(x + 10) }; }
    export function endsBelow(line: Line): number { return line.from.x + line.to.y; }
    export type Tree = { value: number; left: Tree | null; right: Tree | null };
    export function makeTree(depth: number): Tree { return { value: depth, left: depth ? makeTree(depth - 1) : null, right: depth ? makeTree(depth - 1) : null }; }
    export function sumBelow(p: Point): number { return p.x + p.y; }
    export function storeBelow(p: Point, x: number): void { p.x = x; }
    export function storeAnythingBelow(p: any, value: unknown): void { p.x = value; }
    export function removeBelow(p: any): void { delete p.x; }
    export class Box {
      constructor(public side: number, public name: string = "box") {}
      area(): number { return this.side * this.side; }
      get twice(): number { return this.side * 2; }
    }
    export class Crate extends Box {
      lid = true;
      area(): number { return super.area() + 1; }
    }
    export const POINTS: Point[] = [make(1), makeOtherOrder(2), makeWide(3)];`,
  "src/upper.ts": `
    import type { Box, Line, Maybe, Point, Tree } from "./lower";
    export function sum(p: Point): number { return p.x + p.y; }
    export function describe(p: Point): string { return p.label + ":" + p.x + ":" + p.y; }
    export function onlyX(p: { x: number }): number { return p.x; }
    export function store(p: Point, x: number): void { p.x = x; }
    export function add(p: Point, by: number): number { p.x += by; return p.x; }
    export function storeWithoutTypes(p: any, value: any): void { p.x = value; p.y = value; }
    export function storeInLoop(points: any[], values: any[]): void { for (let i = 0; i < points.length; i++) { const p = points[i]; p.x = values[i % values.length]; p.label = p.label + "!"; } }
    export function keys(p: Point): string { return Object.keys(p).join(); }
    export function listed(p: Point): string { const names: string[] = []; for (const name in p) names.push(name); return names.join(); }
    export function text(p: Point): string { return JSON.stringify(p); }
    export function copy(p: Point): Point { return { ...p }; }
    export function own(x: number): Point { return { x, y: -1, label: "own" }; }
    export function has(p: Point): string { return ("x" in p) + " " + Object.hasOwn(p, "x") + " " + (p.x === undefined); }
    export function hasOther(p: Point): string { return ("z" in p) + " " + ("missing" in p) + " " + Object.hasOwn(p, "z") + " " + (p as any).missing + " " + ("toString" in p); }
    export function note(m: Maybe): string { return m.id + ":" + m.note + ":" + ("note" in m); }
    export function setNote(m: Maybe, value: string): void { m.note = value; }
    export function ends(line: Line): number { return line.from.x + line.to.y; }
    export function setFrom(line: Line, from: Point): void { line.from = from; }
    export function walk(tree: Tree | null): number { return tree ? tree.value + walk(tree.left) + walk(tree.right) : 0; }
    export function side(b: Box): string { return b.side + ":" + b.name + ":" + b.area() + ":" + b.twice; }
    export function grow(b: Box): void { b.side++; }
    export function total(points: Point[]): number { let all = 0; for (const p of points) all += sum(p); return all; }`,
  "objects.test.ts": `
    import { test } from "bun:test";
    import * as lower from "./src/lower";
    import * as upper from "./src/upper";
    const say = (...words: unknown[]) => console.log("SAID " + words.map(word => { try { return String(word); } catch (error) { return "threw"; } }).join(" "));
    const told = (ask: () => unknown) => { try { return ask(); } catch (error: any) { return error.name + ": " + error.message; } };
    const every = (p: any) => [upper.sum(p), upper.describe(p), upper.onlyX(p), upper.keys(p), upper.listed(p), upper.text(p), upper.has(p), upper.hasOther(p), JSON.stringify(upper.copy(p)), lower.sumBelow(p)].join(" | ");

    test("as they are made", () => {
      for (const p of [lower.make(1), lower.makeOtherOrder(2), lower.makeWide(3), upper.own(4), ...lower.POINTS]) say("made", every(p));
      say("total", upper.total(lower.POINTS), upper.total([upper.own(1), lower.make(2)]));
      say("line", upper.ends(lower.makeLine(5)));
    });
    test("stores from either side", () => {
      const p = lower.make(1);
      upper.store(p, 7); say("stored", every(p));
      upper.store(p, 1.5); say("fraction", every(p));
      upper.store(p, 2 ** 40); say("large", every(p));
      upper.store(p, -0); say("minus zero", Object.is(p.x, -0), every(p));
      upper.store(p, NaN); say("nan", every(p));
      lower.storeBelow(p, 3); say("below", every(p), upper.add(p, 2), upper.add(p, 0.25), every(p));
      for (const value of ["text", undefined, null, true, 10n, { a: 1 }, () => 1, Symbol.iterator]) {
        const q = lower.make(1);
        lower.storeAnythingBelow(q, value);
        say("other type below", told(() => upper.onlyX(q)), told(() => upper.has(q)), told(() => upper.keys(q)));
        const r = lower.make(1);
        (upper.store as any)(r, value);
        say("other type above", told(() => upper.onlyX(r)), told(() => lower.sumBelow(r)), told(() => upper.keys(r)));
        lower.storeBelow(r, 4); say("and back", every(r));
      }
    });
    test("what changes an object", () => {
      let p: any = lower.make(1);
      lower.removeBelow(p); say("removed", every(p));
      p.x = 5; say("added again", every(p));
      p = lower.make(1); delete p.y; say("removed above", every(p));
      p = lower.make(1); p.extra = 1; say("extra", every(p));
      p = lower.make(1); Object.defineProperty(p, "x", { get() { return 40; }, enumerable: true, configurable: true }); say("getter", every(p), told(() => upper.store(p, 1)), every(p));
      p = lower.make(1); Object.defineProperty(p, "x", { value: 41, writable: false, enumerable: false, configurable: true }); say("read only", every(p), told(() => upper.store(p, 1)), told(() => upper.add(p, 1)), every(p));
      p = lower.make(1); Object.freeze(p); say("frozen", every(p), told(() => upper.store(p, 1)), every(p));
      p = lower.make(1); Object.seal(p); say("sealed", every(p), told(() => upper.store(p, 2)), every(p));
      p = lower.make(1); Object.preventExtensions(p); delete p.x; say("closed", every(p), told(() => upper.store(p, 2)), every(p));
      p = lower.make(1); Object.setPrototypeOf(p, { x: 50, inherited: 1 }); say("prototype", every(p)); delete p.x; say("inherits", every(p)); upper.store(p, 6); say("own again", every(p));
      p = lower.make(1); Object.setPrototypeOf(p, null); say("no prototype", every(p));
      p = lower.make(1); Object.setPrototypeOf(p, { set x(value: number) { say("setter", value); } }); delete p.x; upper.store(p, 8); say("setter above", upper.has(p));
      p = new Proxy(lower.make(1), { get(target: any, key) { return key === "x" ? 60 : target[key]; } }); say("proxy", upper.sum(p), upper.describe(p));
    });
    test("what is not such an object", () => {
      for (const value of [{ x: 1, y: 2, label: "plain" }, JSON.parse('{"x":1,"y":2,"label":"parsed"}'), Object.assign(Object.create({ x: 1 }), { y: 2, label: "half" }), { x: "a", y: "b", label: 3 }, [1, 2], "text", 5, null, undefined, () => 1])
        say("other", told(() => upper.sum(value as any)), told(() => upper.describe(value as any)), told(() => upper.onlyX(value as any)));
    });
    test("fields that may be missing", () => {
      const without = lower.makeMaybe(1), having = lower.makeMaybe(2, "n");
      say("maybe", upper.note(without), upper.note(having));
      upper.setNote(without, "late"); upper.setNote(having, "new");
      say("maybe", upper.note(without), upper.note(having), Object.keys(without), Object.keys(having));
    });
    test("objects in the fields of objects", () => {
      const both = (line: any) => told(() => upper.ends(line)) + " " + told(() => lower.endsBelow(line)) + " " + told(() => JSON.stringify(line));
      let line: any = lower.makeLine(5);
      say("line", both(line));
      upper.setFrom(line, lower.make(9)); say("their point", both(line));
      upper.setFrom(line, lower.makeWide(8)); say("their wide point", both(line));
      upper.setFrom(line, upper.own(100)); say("my point", both(line));
      for (const value of [{ x: 7 }, { x: "seven", y: 1, label: "l" }, null, undefined, 5, "text", new lower.Box(1), [1], () => 1, Object.create(lower.make(3))]) {
        line = lower.makeLine(5); line.from = value; say("another value", both(line));
        line = lower.makeLine(5); (upper.setFrom as any)(line, value); say("another value from above", both(line));
        upper.setFrom(line, lower.make(2)); say("and back", both(line));
      }
      line = lower.makeLine(5); delete line.from; say("no field", both(line));
      line = lower.makeLine(5); delete line.to.y; say("no field within", both(line));
      line = lower.makeLine(5); Object.defineProperty(line.to, "y", { get() { return 90; }, enumerable: true }); say("getter within", both(line));
      line = lower.makeLine(5); line.to.y = "text"; say("other type within", both(line));
      line = lower.makeLine(5); Object.setPrototypeOf(line.from, { x: 1 }); delete line.from.x; say("inherits within", both(line));
      line = lower.makeLine(5); line.from.more = 1; say("more within", both(line));
      const tree: any = lower.makeTree(4);
      say("tree", upper.walk(tree));
      tree.left.right = null; say("cut", upper.walk(tree));
      tree.right.left = { value: 1000, left: null, right: null }; say("my node", upper.walk(tree));
      tree.right.right = undefined; say("undefined", told(() => upper.walk(tree)));
      tree.left.left = { value: "v", left: null, right: null }; say("text", told(() => upper.walk(tree)));
    });
    test("instances of classes", () => {
      const box = new lower.Box(3), crate = new lower.Crate(4, "crate");
      say("classes", upper.side(box), upper.side(crate), box instanceof lower.Box, crate instanceof lower.Box, Object.keys(crate));
      upper.grow(box); upper.grow(crate); say("grown", upper.side(box), upper.side(crate));
      (box as any).area = () => -1; say("own method", upper.side(box));
      const kept = lower.Box.prototype.area;
      lower.Box.prototype.area = function () { return 1000; }; say("replaced method", upper.side(new lower.Box(2)), upper.side(crate));
      lower.Box.prototype.area = kept;
      Object.defineProperty(crate, "side", { get() { return 70; }, configurable: true }); say("getter", upper.side(crate));
      class Above extends lower.Box { area() { return 5; } }
      say("class above", upper.side(new Above(6)), upper.side({ side: 1, name: "fake", area: () => 2, twice: 3 } as any));
      Object.setPrototypeOf(box, lower.Crate.prototype); say("other class", told(() => upper.side(box)));
    });
    test("often, so that the code is what runs hot", () => {
      let all = 0;
      const many = Array.from({ length: 100 }, (_, i) => (i % 3 ? lower.make(i) : i % 2 ? upper.own(i) : lower.makeOtherOrder(i)));
      for (let round = 0; round < 2000; round++) all += upper.total(many);
      say("often", all);
      for (let round = 0; round < 300; round++) {
        upper.storeInLoop(many, [round, round + 0.5]);
        for (const p of many) upper.storeWithoutTypes(p, round);
      }
      say("stored often", upper.total(many), many[1].label.length);
      upper.storeInLoop(many, ["text", null, undefined, 7]);
      say("stored other types", many.slice(0, 6).map(p => told(() => upper.describe(p))).join());
    });
    test("their objects against my own", () => {
      const leastOf = (read: () => number) => {
        let least = Infinity;
        for (let round = 0; round < 9; round++) {
          const before = Bun.nanoseconds();
          read();
          least = Math.min(least, Bun.nanoseconds() - before);
        }
        return least;
      };
      const theirs = Array.from({ length: 1000 }, (_, i) => lower.make(i)), mine = Array.from({ length: 1000 }, (_, i) => upper.own(i));
      const ofMine = leastOf(() => { let all = 0; for (let round = 0; round < 100; round++) all += upper.total(mine); return all; });
      const ofTheirs = leastOf(() => { let all = 0; for (let round = 0; round < 100; round++) all += upper.total(theirs); return all; });
      console.log("TIMES " + (ofTheirs / ofMine).toFixed(2));
    });`,
};

async function runIn(words: string | undefined, ...flags: string[]) {
  using dir = tempDir("aot-objects-from-below", files);
  const env = { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words };
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--isolate", ...flags], String(dir), env);
  const failed = stderr.split("\n").filter(line => /^\(fail\)|^✗|^panic|^error/.test(line));
  const said = stdout.split("\n").filter(line => line.startsWith("SAID"));
  return { said, failed, exitCode, times: Number(/^TIMES (.*)$/m.exec(stdout)?.[1]) };
}

test("it says what plain Bun says as one program, in two layers and with a border between the two files", async () => {
  const [plain, one, two, three] = await Promise.all([
    runIn(undefined),
    runIn("TestRunLayers:0", "--aot"),
    runIn("TestRunLayers:2,TestRunPartFiles:1", "--aot"),
    runIn("TestRunLayers:3,TestRunPartFiles:1", "--aot"),
  ]);
  expect(plain.said.length).toBeGreaterThan(110);
  const withoutTimes = ({ times, ...rest }: typeof plain) => rest;
  expect(withoutTimes(plain)).toEqual({ said: plain.said, failed: [], exitCode: 0 });
  expect(withoutTimes(one)).toEqual(withoutTimes(plain));
  expect(withoutTimes(two)).toEqual(withoutTimes(plain));
  expect(withoutTimes(three)).toEqual(withoutTimes(plain));
  // By name it was ten times.
  expect(three.times).toBeLessThan(5);
});
