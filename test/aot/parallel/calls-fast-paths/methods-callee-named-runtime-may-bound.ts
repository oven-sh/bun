// A callee that is named at run time may take four methods of a class. `k.m.bind(k)` then creates a small closure for a plain method and for an async one, and a method that has another name or another prototype by then is bound with what it has. What the methods inherit is read from them too.
import "../../fixtures/jsc-shell-functions.ts";
declare const console: any; declare const process: any; declare function memoryUsageStatistics(): any; declare function gc(): void;
class K {
  v = 1;
  plain(x: number): number { return this.v + x; }
  async later(x: number): Promise<number> { return this.v + x; }
  async renamed(x: number): Promise<number> { return this.v - x; }
  async moved(x: number): Promise<number> { return this.v * x; }
}
const takes: any = (globalThis as any)[process.env.A_NAME_THAT_IS_NOT_SET ?? "a name that nothing has"];
if (takes) { takes(K.prototype.plain); takes(K.prototype.later); takes(K.prototype.renamed); takes(K.prototype.moved); }

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
shows();
export {};
/* Output:
bytes alive for an object, its bound method and the array's slot: 72
bytes alive for an object, its bound async method and the array's slot: 72
bound plain 1 false true 20001
bound later 1 true false 20001
bound another name 1 true false 19997
bound moved 1 false true 39998
20000 20001 true true AsyncFunction true 39998
10100 800000
*/
