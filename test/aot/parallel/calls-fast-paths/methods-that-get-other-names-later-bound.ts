// A callee that is named at run time may take the methods of a class, and a description of a property of the global object is printed: the methods may get other names while the program runs, and stack frames show the names they have by then.
// `k.m.bind(k)` still creates a small closure for a plain method and for an async one, and the frame of a method that was called through such a closure has the name of the method's function object.
import "../../fixtures/jsc-shell-functions.ts";
declare const console: any; declare const process: any; declare function memoryUsageStatistics(): any; declare function gc(): void;
class K {
  v = 1;
  plain(x: number): number { return this.v + x; }
  async later(x: number): Promise<number> { return this.v + x; }
  async renamed(x: number): Promise<number> { return this.v - x; }
  async moved(x: number): Promise<number> { return this.v * x; }
  fails(x: number): number { if (x > this.v) throw new Error("more than " + this.v); return x; }
  async failsLater(x: number): Promise<number> { if (x > this.v) throw new Error("later, more than " + this.v); return x; }
}
console.log(Object.getOwnPropertyDescriptor(globalThis, "a name that nothing has"));
const takes: any = (globalThis as any)[process.env.A_NAME_THAT_IS_NOT_SET ?? "a name that nothing has"];
if (takes) { takes(K.prototype.plain); takes(K.prototype.later); takes(K.prototype.renamed); takes(K.prototype.moved); takes(K.prototype.fails); takes(K.prototype.failsLater); }

const kept: Array<Array<(x: number) => unknown>> = [];
function makes(n: number, isAsync: boolean): void { for (let i = 0; i < n; i++) { if (i % 1000 === 0) kept.push([]); const k = new K(); k.v = i; kept[kept.length - 1].push(isAsync ? k.later.bind(k) : k.plain.bind(k)); } }
for (const isAsync of [false, true]) {
  gc(); const before = memoryUsageStatistics().heapSize;
  makes(400_000, isAsync);
  gc(); const after = memoryUsageStatistics().heapSize;
  console.log("bytes alive for an object, its bound " + (isAsync ? "async " : "") + "method and the array's slot: " + Math.round((after - before) / 400_000 / 8) * 8);
}

Object.defineProperty(K.prototype.renamed, "name", { value: "another name" });
Object.setPrototypeOf(K.prototype.moved, Function.prototype);
function binds(k: K): Array<(x: number) => unknown> { return [k.plain.bind(k), k.later.bind(k), k.renamed.bind(k), k.moved.bind(k)]; }
async function shows(): Promise<void> {
  const prototypeOfAsyncFunctions = Object.getPrototypeOf(async function () {});
  let bound: Array<(x: number) => unknown> = [];
  for (let i = 0; i < 20_000; i++) { const k = new K(); k.v = i; bound = binds(k); }
  for (const f of bound) console.log(f.name, f.length, Object.getPrototypeOf(f) === prototypeOfAsyncFunctions, Object.getPrototypeOf(f) === Function.prototype, await f(2));
  let read: unknown[] = [];
  for (let i = 0; i < 20_000; i++) { const k = new K(); k.v = i; read = [await k.later.call(k, 1), await k.later.apply(k, [2]), k.later.constructor === prototypeOfAsyncFunctions.constructor, k.plain.constructor === Function, (k.later as any)[Symbol.toStringTag], k.moved.constructor === Function, await k.moved.call(k, 2)]; }
  console.log(...read);
  let sum = 0; for (let i = 0; i < 100; i++) sum += (kept[0][i](1) as number) + ((await kept[400][i](1)) as number);
  console.log(sum, kept.length * kept[0].length);
}
await shows();

const namesIn = (error: any): string => String(error.stack).split("\n").slice(1).map(line => line.trim().replace(/^at /, "").replace(/ ?\(.*\)$/, "").replace(/^(?:[A-Z]:)?[\\/].*$/, "<file>")).join(" < ");
function bindsWhatFails(k: K): Array<(x: number) => unknown> { return [k.fails.bind(k), k.failsLater.bind(k), k.fails.bind(k, 7), k.failsLater.bind(k, 8)]; }
async function showsFrames(label: string): Promise<void> {
  let bound: Array<(x: number) => unknown> = [];
  for (let i = 0; i < 20_000; i++) { const k = new K(); k.v = i % 5; bound = bindsWhatFails(k); }
  for (const f of bound) {
    try {
      console.log(label, f.name, f.length, await f(2));
      console.log(label, f.name, f.length, await f(6));
    } catch (error: any) {
      console.log(label, f.name, f.length, error.message, "|", namesIn(error));
    }
  }
  try { new (bound[0] as any)(9); } catch (error: any) { console.log(label, error.constructor.name); }
  console.log(label, typeof bound[0], Object.getOwnPropertyNames(bound[0]).join());
}
const keptOfWhatFails: Array<Array<(x: number) => unknown>> = [];
function makesOfWhatFails(n: number, isAsync: boolean): void { for (let i = 0; i < n; i++) { if (i % 1000 === 0) keptOfWhatFails.push([]); const k = new K(); k.v = i; keptOfWhatFails[keptOfWhatFails.length - 1].push(isAsync ? k.failsLater.bind(k) : k.fails.bind(k)); } }
for (const isAsync of [false, true]) {
  gc(); const before = memoryUsageStatistics().heapSize;
  makesOfWhatFails(400_000, isAsync);
  gc(); const after = memoryUsageStatistics().heapSize;
  console.log("bytes alive for an object, its bound " + (isAsync ? "async " : "") + "method that gets another name later and the array's slot: " + Math.round((after - before) / 400_000 / 8) * 8);
}
await showsFrames("as written:");
Object.defineProperty(K.prototype.fails, "name", { value: "fails under another name" });
Object.defineProperty(K.prototype.failsLater, "name", { value: "fails later under another name" });
await showsFrames("renamed:");
try { keptOfWhatFails[0][3](5); } catch (error: any) { console.log("bound before:", keptOfWhatFails[0][3].name, error.message, "|", namesIn(error)); }
try { await keptOfWhatFails[400][3](5); } catch (error: any) { console.log("bound before:", keptOfWhatFails[400][3].name, error.message, "|", namesIn(error)); }
export {};
/* Output:
undefined
bytes alive for an object, its bound method and the array's slot: 72
bytes alive for an object, its bound async method and the array's slot: 72
bound plain 1 false true 20001
bound later 1 true false 20001
bound another name 1 true false 19997
bound moved 1 false true 39998
20000 20001 true true AsyncFunction true 39998
10100 800000
bytes alive for an object, its bound method that gets another name later and the array's slot: 72
bytes alive for an object, its bound async method that gets another name later and the array's slot: 72
as written: bound fails 1 2
as written: bound fails 1 more than 4 | fails < showsFrames
as written: bound failsLater 1 2
as written: bound failsLater 1 later, more than 4 | failsLater < showsFrames
as written: bound fails 0 more than 4 | fails < showsFrames
as written: bound failsLater 0 later, more than 4 | failsLater < showsFrames
as written: TypeError
as written: function length,name
renamed: bound fails under another name 1 2
renamed: bound fails under another name 1 more than 4 | fails under another name < showsFrames
renamed: bound fails later under another name 1 2
renamed: bound fails later under another name 1 later, more than 4 | fails later under another name < showsFrames
renamed: bound fails under another name 0 more than 4 | fails under another name < showsFrames
renamed: bound fails later under another name 0 later, more than 4 | fails later under another name < showsFrames
renamed: TypeError
renamed: function length,name
bound before: bound fails more than 3 | fails under another name < <file>
bound before: bound failsLater later, more than 3 | fails later under another name < <file>
*/
