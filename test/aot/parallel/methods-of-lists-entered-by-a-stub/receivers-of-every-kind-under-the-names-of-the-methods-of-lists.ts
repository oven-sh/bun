// `x.some(f)`, `x.map(f)` ..: the source says that `x` is a list. What comes is a list, a list with a name of its own, a list with another prototype, an instance of a subclass, a typed array, a Map, a Set,
// an iterator, a plain object with such a method, an arguments object with a borrowed method, a proxy of a list, a string object, a frozen list, a list with holes, and a list whose class has lost nothing.
function show(value: unknown): string {
  if (Array.isArray(value)) return (Object.getPrototypeOf(value) === Array.prototype ? "" : "(other prototype)") + JSON.stringify(value);
  if (value instanceof Int32Array) return "Int32Array " + Array.from(value).join();
  if (typeof value === "object" && value !== null && typeof (value as any).next === "function") return "iterator " + JSON.stringify(Array.from(value as Iterable<unknown>));
  return String(value);
}
// Something stands behind each call: a call in tail position goes another way.
let calls = 0;
function atOf(x: number[]): unknown {
  const answer = x.at(-1);
  calls++;
  return answer;
}
function everyOf(x: number[]): unknown {
  const answer = x.every(v => v > 0);
  calls++;
  return answer;
}
function filterOf(x: number[]): unknown {
  const answer = x.filter(v => v > 1);
  calls++;
  return answer;
}
function findOf(x: number[]): unknown {
  const answer = x.find(v => v > 1);
  calls++;
  return answer;
}
function findIndexOf(x: number[]): unknown {
  const answer = x.findIndex(v => v > 1);
  calls++;
  return answer;
}
function findLastOf(x: number[]): unknown {
  const answer = x.findLast(v => v > 1);
  calls++;
  return answer;
}
function findLastIndexOf(x: number[]): unknown {
  const answer = x.findLastIndex(v => v > 1);
  calls++;
  return answer;
}
function flatMapOf(x: number[]): unknown {
  const answer = x.flatMap(v => [v, v]);
  calls++;
  return answer;
}
function forEachOf(x: number[]): unknown {
  const seen: unknown[] = [];
  x.forEach(v => seen.push(v));
  return seen.length;
}
function mapOf(x: number[]): unknown {
  const answer = x.map(v => v * 2);
  calls++;
  return answer;
}
function reduceOf(x: number[]): unknown {
  const answer = x.reduce((a, v) => a + v, 0);
  calls++;
  return answer;
}
function reduceRightOf(x: number[]): unknown {
  const answer = x.reduceRight((a, v) => a + "" + v, "");
  calls++;
  return answer;
}
function someOf(x: number[]): unknown {
  const answer = x.some(v => v > 2);
  calls++;
  return answer;
}
const asks: [string, (x: number[]) => unknown][] = [
  ["at", atOf],
  ["every", everyOf],
  ["filter", filterOf],
  ["find", findOf],
  ["findIndex", findIndexOf],
  ["findLast", findLastOf],
  ["findLastIndex", findLastIndexOf],
  ["flatMap", flatMapOf],
  ["forEach", forEachOf],
  ["map", mapOf],
  ["reduce", reduceOf],
  ["reduceRight", reduceRightOf],
  ["some", someOf],
];
function all(list: number[]): string {
  const out: string[] = [];
  for (const [name, ask] of asks) {
    try {
      out.push(name + "=" + show(ask(list)));
    } catch (error) {
      out.push(name + " throws " + (error as Error).constructor.name);
    }
  }
  return out.join(" ");
}
class Sub extends Array<number> {
  some(): boolean {
    return "mine" as unknown as boolean;
  }
}
class Quiet extends Array<number> {}
const named: any = [1, 2, 3];
named.some = () => "own some";
named.map = () => "own map";
const reparented: any = [1, 2, 3];
Object.setPrototypeOf(reparented, { __proto__: Array.prototype, filter: () => "filter of the new prototype", at: () => "at of the new prototype" });
const bare: any = [1, 2, 3];
Object.setPrototypeOf(bare, null);
const plain: any = { length: 2, 0: 5, 1: 6, some: Array.prototype.some, map: (f: unknown) => "plain map", at: Array.prototype.at, every: Array.prototype.every };
const borrowed: any = (function (..._: number[]) {
  const a: any = arguments;
  a.some = Array.prototype.some;
  a.filter = Array.prototype.filter;
  a.reduce = Array.prototype.reduce;
  return a;
})(4, 5, 6);
const holes: any = [1, , 3];
const receivers: [string, any][] = [
  ["list", [1, 2, 3]],
  ["empty", []],
  ["numbers with fractions", [1.5, 2.5]],
  ["own names", named],
  ["other prototype", reparented],
  ["no prototype", bare],
  ["subclass with its own", Sub.from([1, 2, 3])],
  ["subclass", Quiet.from([1, 2, 3])],
  ["typed array", new Int32Array([1, 2, 3])],
  ["map", new Map([[1, 2]])],
  ["set", new Set([1, 2, 3])],
  ["iterator", [1, 2, 3].values()],
  ["plain object", plain],
  ["arguments", borrowed],
  ["proxy", new Proxy([1, 2, 3], {})],
  ["string object", new String("ab")],
  ["frozen", Object.freeze([1, 2, 3])],
  ["holes", holes],
  ["null", null],
  ["undefined", undefined],
  ["number", 7],
  ["text", "abc"],
];
for (const [name, receiver] of receivers) console.log(name + ": " + all(receiver));
console.log(calls);
