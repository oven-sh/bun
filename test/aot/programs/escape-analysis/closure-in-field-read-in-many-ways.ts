// One closure stored in a field has one identity, however and wherever the field is read.
declare const console: any;
declare const Bun: any;
const out: string[] = [];
function say(name: string, value: unknown): void { out.push(name + "=" + String(value)); }
function collect(): void { Bun.gc(true); }

interface A1 { a: number; m: () => number }
function makeA1(): A1 { return { a: 1, m: () => 1 }; }
function a1(): void { const o = makeA1(); say("local/twice", o.m === o.m); }

interface A2 { a: number; m: () => number }
let keptA2: A2 | undefined;
function makeA2(): A2 { return { a: 1, m: () => 1 }; }
function a2(): void { const o = makeA2(); const f = o.m; keptA2 = o; say("read-then-escape", f === keptA2!.m); }

interface A3 { a: number; m: () => number }
let keptA3: A3 | undefined;
function makeA3(): A3 { return { a: 1, m: () => 1 }; }
function a3(): void { const o = makeA3(); keptA3 = o; const f = o.m; say("escape-then-read", f === keptA3!.m); }

interface A4 { a: number; m: () => number }
function makeA4(): A4 { return { a: 1, m: () => 1 }; }
function readA4(o: A4, depth: number): () => number { return depth > 0 ? readA4(o, depth - 1) : o.m; }
function a4(): void { const o = makeA4(); const f = readA4(o, 3); say("read-in-callee", f === o.m); }

interface A5 { a: number; m: () => number }
function makeA5(): A5 { return { a: 1, m: () => 1 }; }
function a5(key: string): void { const o = makeA5(); const f = (o as any)[key]; say("dynamic-key", f === o.m); }

interface A6 { a: number; m: () => number }
function makeA6(): A6 { return { a: 1, m: () => 1 }; }
function a6(): void { const o = makeA6(); const { m } = o; say("destructured", m === o.m); }

interface A7 { a: number; m: () => number }
function makeA7(): A7 { return { a: 1, m: () => 1 }; }
function a7(): void {
  const o = makeA7();
  say("values", Object.values(o)[1] === o.m);
  say("entries", Object.entries(o)[1][1] === o.m);
  say("assign", Object.assign({}, o).m === o.m);
  say("spread", { ...o }.m === o.m);
}

interface A8 { a: number; m: () => number }
function makeA8(): A8 { return { a: 1, m: () => 1 }; }
function a8(): void { const o = makeA8(); say("descriptor", Object.getOwnPropertyDescriptor(o, "m")!.value === o.m); say("reflect", Reflect.get(o, "m") === o.m); }

interface A9 { a?: number; m: () => number }
function makeA9(): A9 { return { a: 1, m: () => 1 }; }
function a9(): void { const o = makeA9(); const f = o.m; delete o.a; say("after-delete", f === o.m); }

interface A10 { a: number; m: () => number }
function makeA10(): A10 { return { a: 1, m: () => 1 }; }
function a10(): void { const o = makeA10(); const f = o.m; Object.freeze(o); say("after-freeze", f === o.m); const p = makeA10(); Object.freeze(p); say("frozen-first", p.m === p.m); }

interface A12 { a: number; m: () => number }
function makeA12(): A12 { return { a: 1, m: () => 1 }; }
function a12(): void { const o = makeA12(); (o.m as any).tag = 5; collect(); const junk: unknown[] = []; for (let i = 0; i < 2000; i++) junk.push({ i }); collect(); say("tag-after-collection", (o.m as any).tag + junk.length); }

interface A13 { a: number; m: () => number }
function makeA13(i: number): A13 { return { a: i, m: () => 1 }; }
function a13(): void {
  const objects: A13[] = [];
  for (let i = 0; i < 4; i++) objects.push(makeA13(i));
  let same = 0, different = 0;
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { if (objects[i].m === objects[j].m) same++; else different++; }
  say("array-of-objects", same + "/" + different);
}

interface A14 { a: number; m: () => number }
function makeA14(): A14 { return { a: 1, m: () => 1 }; }
function a14(flag: boolean): void { const o = makeA14(), p = makeA14(); const q = flag ? o : p; say("joined", (q.m === o.m) + "/" + (q.m === p.m)); }

interface A15 { a: number; m: () => number }
function makeA15(): A15 { return { a: 1, m: () => 1 }; }
const weakA15 = new WeakMap<object, number>();
function a15(): void { const o = makeA15(); weakA15.set(o.m, 1); collect(); say("weak-map", weakA15.has(o.m)); }

interface A16 { a: number; m: () => number }
function makeA16(): A16 { return { a: 1, m: () => 1 }; }
function a16(): void { let last: unknown; let same = 0; const o = makeA16(); for (let i = 0; i < 5; i++) { const f = o.m; if (f === last) same++; last = f; if (i === 2) collect(); } say("loop", same); }

interface A17 { a: number; m: () => number }
function makeA17(): A17 { return { a: 1, m: () => 1 }; }
function a17(): void { const o = makeA17(); let f: unknown; try { f = o.m; throw new Error("x"); } catch { say("across-throw", f === o.m); } }

interface A18 { a: number; m: () => number }
function makeA18(): A18 { return { a: 1, m: () => 1 }; }
async function a18(): Promise<void> { const o = makeA18(); const f = o.m; await null; say("across-await", f === o.m); }

interface A19 { a: number; m: () => number }
function makeA19(): A19 { return { a: 1, m: () => 1 }; }
function* genA19(): Generator<unknown> { const o = makeA19(); yield o.m; yield o.m; }
function a19(): void { const [f, g] = [...genA19()]; say("across-yield", f === g); }

interface A20 { a: number; m: () => number; n: () => number }
function makeA20(): A20 { return { a: 1, m: () => 1, n: () => 2 }; }
function a20(): void { const o = makeA20(); say("two-fields", (o.m === o.m) + "/" + (o.n === o.n) + "/" + ((o.m as unknown) === o.n) + "/" + o.m() + o.n()); }

interface A21 { a: number; m: () => number }
function makeA21(): A21 { return { a: 1, m: () => 1 }; }
function a21(): void { const o = makeA21(); say("name-and-length", o.m.name + "/" + o.m.length + "/" + typeof o.m + "/" + (o.m.constructor === Function) + "/" + ("prototype" in o.m)); }

a1(); a2(); a3(); a4(); a5("m"); a6(); a7(); a8(); a9(); a10(); a12(); a13(); a14(true); a14(false); a15(); a16(); a17(); a19(); a20(); a21();
a18().then(() => console.log(out.join("\n")));
