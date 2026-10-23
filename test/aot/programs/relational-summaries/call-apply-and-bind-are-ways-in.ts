// The same function is entered by a plain call, by call, apply, Reflect.apply, a bound function, a spread, a tagged template, a getter, a timer and built-ins that take callbacks. The positions of the operands shift, some are missing, some are too many; what the function does with parameter n happens to whatever landed there.
function churn(depth: number): number {
  const pair = { left: depth, right: -depth };
  const list = [depth, depth + 1, depth + 2];
  const read = () => pair.left + list[1];
  if (depth > 0) return churn(depth - 1) + read();
  Bun.gc(true);
  return read();
}
interface Thing {
  tag: string;
}
const kept: (Thing | undefined)[] = [];
// Reads the first, keeps the second, returns the third.
function readKeepReturn(a?: Thing, b?: Thing, c?: Thing): Thing | undefined {
  if (a && a.tag === "never") return a;
  kept.push(b);
  return c;
}
const t = (tag: string): Thing => ({ tag });
const show = (x: Thing | undefined) => (x === undefined ? "undefined" : x.tag);
const bound0 = readKeepReturn.bind(null);
const bound1 = readKeepReturn.bind(null, t("bound first"));
const bound2 = readKeepReturn.bind(null, t("bound first"), t("bound second"));
const bound3 = readKeepReturn.bind(null, t("bound first"), t("bound second"), t("bound third"));
const boundTwice = readKeepReturn.bind(null, t("inner first")).bind(null, t("outer, so second"));
function round(i: number): string[] {
  const a = t("a" + i);
  const b = t("b" + i);
  const c = t("c" + i);
  const list = [a, b, c];
  return [
    readKeepReturn(a, b, c),
    readKeepReturn.call(null, a, b, c),
    readKeepReturn.apply(null, [a, b, c]),
    readKeepReturn.apply(null, list as [Thing, Thing, Thing]),
    Reflect.apply(readKeepReturn, null, [a, b, c]),
    readKeepReturn(...(list as [Thing, Thing, Thing])),
    readKeepReturn(a, ...([b, c] as [Thing, Thing])),
    bound0(a, b, c),
    bound1(b, c),
    bound2(c),
    bound3(),
    boundTwice(c),
    readKeepReturn(a, b),
    readKeepReturn(a),
    readKeepReturn(),
    readKeepReturn.call(a, b, c),
    readKeepReturn.call(null),
    readKeepReturn.apply(null, []),
    readKeepReturn.apply(null),
    (readKeepReturn as (...all: Thing[]) => Thing | undefined)(a, b, c, t("a fourth")),
    Function.prototype.call.call(readKeepReturn, null, a, b, c),
    Function.prototype.apply.call(readKeepReturn, null, [a, b, c]),
    Function.prototype.call.apply(readKeepReturn, [null, a, b, c]),
    readKeepReturn.apply(null, { length: 3, 0: a, 1: b, 2: c } as unknown as [Thing, Thing, Thing]),
    readKeepReturn.apply(null, { length: 2, 0: a, 1: b, 2: c } as unknown as [Thing, Thing]),
  ].map(show);
}
let lines: string[] = [];
for (let i = 0; i < 100; i++) {
  kept.length = 0;
  lines = round(i);
}
console.log(lines.join());
console.log(churn(60), kept.map(show).join());

// Built-ins choose the operands.
kept.length = 0;
const things = [t("x"), t("y")];
console.log(
  things.map(readKeepReturn as never).map(x => (Array.isArray(x) ? "the array" : String(x))).join(),
  things.forEach(readKeepReturn as never),
  things.reduce(readKeepReturn as never, t("start")) as unknown,
  kept.map(k => (typeof k === "object" ? k.tag : String(k))).join(),
);
kept.length = 0;
function tagged(strings: TemplateStringsArray, ...values: Thing[]): unknown {
  return readKeepReturn(strings as unknown as Thing, values[0], values[1]);
}
console.log(show(tagged`one ${t("first value")} two ${t("second value")} three` as Thing), show(kept[0]));
const results: string[] = [];
setTimeout((a: Thing, b: Thing, c: Thing) => results.push("timer " + show(readKeepReturn(a, b, c))), 0, t("t1"), t("t2"), t("t3"));
queueMicrotask(() => results.push("microtask " + show(readKeepReturn(t("m1"), t("m2"), t("m3")))));
Promise.resolve(t("p1")).then(readKeepReturn).then(x => results.push("then " + show(x)));
new Promise<Thing>(readKeepReturn as never);
console.log(typeof kept[kept.length - 1]);
churn(40);
await new Promise(resolve => setTimeout(resolve, 5));
console.log(results.join(), kept.map(k => (typeof k === "function" ? "a function" : show(k))).join());

// `this` and the operands change places.
function thisOrFirst(this: unknown, first: unknown): unknown {
  return this === undefined ? first : this;
}
function places(i: number): string {
  const self = t("this" + i);
  const first = t("first" + i);
  return [thisOrFirst.call(self, first) === self, thisOrFirst.call(undefined, first) === first, thisOrFirst.apply(self, [first]) === self, thisOrFirst.bind(self)(first) === self, thisOrFirst.bind(self).call(first, first) === self, (thisOrFirst.bind(undefined, self) as (x: unknown) => unknown)(first) === self, Reflect.apply(thisOrFirst, first, [self]) === first, { thisOrFirst }.thisOrFirst(first) === first].join();
}
let placed = "";
for (let i = 0; i < 100; i++) placed = places(i);
console.log(placed);

// An argument list that runs code while it is read.
const order: string[] = [];
const spyList = new Proxy([t("s0"), t("s1"), t("s2")], {
  get(target, key, receiver) {
    order.push(String(key));
    return Reflect.get(target, key, receiver);
  },
});
kept.length = 0;
console.log(show(readKeepReturn.apply(null, spyList as unknown as [Thing, Thing, Thing])), order.splice(0).join(), show(kept[0]));
console.log(show(readKeepReturn(...(spyList as unknown as [Thing, Thing, Thing]))), order.splice(0).join());
