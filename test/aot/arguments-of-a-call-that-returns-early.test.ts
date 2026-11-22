// A callee may return before it needs an argument that is made for the call: a rest array, an object literal, its arguments object.
// The caller then makes it only on the way that goes on. What the program prints stays the same, and so does every stack.
import { buildBothWays } from "./build-both-ways";

const bells = `// No "use strict": the functions of this file are sloppy.
const heard = [];
let asked = 0;

function ropeThatIs(loose) {
  return {
    get loose() {
      asked++;
      return loose;
    },
  };
}

// A bell whose rope is tied gives nothing: its list of strokes is needed behind that question alone.
function hang(tower) {
  function ring(...strokes) {
    if (!ring.rope.loose) return;
    let weight = 0;
    for (let k = 0; k < strokes.length; k++) weight += typeof strokes[k] === "number" ? strokes[k] : strokes[k].length;
    heard.push(tower + " " + strokes.join("+") + " " + weight);
    strokes.unshift(weight);
    return strokes;
  }
  ring.rope = ropeThatIs(false);
  return ring;
}

function whoIsThis(...args) {
  if (args.length === 99) return heard;
  return typeof this + " " + args.length;
}

function thisBehindTest(flag, ...args) {
  if (!flag) return typeof this;
  heard.push("this " + typeof this + " " + args.join("+"));
  return args;
}

function countsArguments(first) {
  if (first === "get" && arguments.length === 1) return "one";
  return Array.prototype.slice.call(arguments, 1).join("|");
}

// What a gate takes of a ship is added up behind the question whether there is a ship.
const gates = { toll: 3 };
for (const side of ["north", "south"]) {
  gates[side] = function (ship) {
    if (ship === undefined) return side.length + this.toll;
    let load = this.toll;
    for (let k = arguments.length - 1; k > 0; k--) load = load * 2 + arguments[k];
    heard.push(side + " " + ship + " " + load);
    return load;
  };
}

module.exports = { hang, ropeThatIs, heard, askedSoFar: () => asked, whoIsThis, thisBehindTest, countsArguments, gates };
`;

const main = `import { askedSoFar, countsArguments, gates, hang as hangOne, heard, ropeThatIs, thisBehindTest, whoIsThis } from "./bells.cjs";

type Bell = { (...strokes: unknown[]): unknown[] | undefined; rope: { readonly loose: boolean } };
const hang = hangOne as (tower: string) => Bell;

const order: string[] = [];
function note<T>(name: string, value: T): T {
  order.push(name);
  return value;
}

// A bell whose rope is tied takes its strokes and returns. They are evaluated all the same, in front of the question.
const ring = hang("gate");
const other = hang("hill");
let sum = 0;
for (let i = 0; i < 30000; i++) {
  ring("slow", "fast", i);
  other("x", i);
  sum += i & 3;
}
console.log(sum, askedSoFar(), heard.length);
console.log(ring(note("a", "slow"), note("b", 1), note("c", 2)), order.join(""));

// Untied, every call gets a list of its own.
ring.rope = ropeThatIs(true);
const first = ring("slow", "one", 2, 3);
const second = ring("slow", "one", 2, 3);
console.log(JSON.stringify(first), first === second, Array.isArray(first), first!.length);
ring.rope = ropeThatIs(false);
console.log(ring("again"), heard.join(";"), ring.length, ring.name);

// The question may throw, and the stack names the function.
const broken = hang("broken");
broken.rope = {
  get loose(): boolean {
    throw new Error("no answer");
  },
};
function callsBroken() {
  broken("a", "b");
}
try {
  callsBroken();
} catch (error) {
  const names = String((error as Error).stack)
    .split("\\n")
    .slice(0, 4)
    .map(line => line.trim().split(" ").slice(0, 2).join(" "));
  console.log(names.join(" | "));
}

// An object that is made for the call is the same object wherever the callee puts it.
type Options = { a: number; b: string };
const kept: Options[] = [];
function configure(on: boolean, options: Options): number {
  if (!on) return -1;
  kept.push(options);
  options.a++;
  for (let i = 0; i < 3; i++) kept.push({ a: options.a + i, b: options.b + i });
  return options.a + kept.length;
}
let total = 0;
for (let i = 0; i < 20000; i++) total += configure(i % 5000 === 0, { a: i, b: "k" });
console.log(total, kept.length, JSON.stringify(kept[4]), kept[0] === kept[4], kept[0]!.a);

// The way out may be a call.
function fallback(value: number) {
  return value * 2;
}
function viaCall(value: number, ...rest: number[]): number {
  if (value < 10) return fallback(value);
  let all = value;
  for (const one of rest) all += one;
  rest.length = 0;
  return all;
}
console.log(viaCall(3, 1, 2), viaCall(30, 1, 2), viaCall.length);

// Two ways out, with something done between them.
let steps = 0;
function twoWaysOut(a: boolean, b: boolean, ...rest: string[]) {
  if (a) return "a";
  steps++;
  if (b) return "b" + steps;
  rest.push("!");
  return rest.join("");
}
console.log(twoWaysOut(true, true, "x"), twoWaysOut(false, true, "x"), twoWaysOut(false, false, "x", "y"), steps);

const receiver = { name: "receiver" };
console.log(whoIsThis.call(receiver, 1, 2), whoIsThis.call(receiver, 1), thisBehindTest.call(receiver, false, 1), JSON.stringify(thisBehindTest.call(receiver, true, 1, 2)), heard.at(-1));
const counts = countsArguments as (...args: unknown[]) => string;
console.log(counts("get"), counts("get", 1, 2), counts("put"), counts("put", 7));
type Gates = Record<string, (...args: unknown[]) => unknown>;
const ships = [undefined, undefined, undefined, "ark"];
let empty = 0;
for (let i = 0; i < 40000; i++) if ((gates as unknown as Gates).north!(ships[i % 4 === 3 && i > 39990 ? 3 : 0]) === 8) empty++;
console.log(empty, (gates as unknown as Gates).south!("ark", 1, 2), (gates as unknown as Gates).south!(), heard.slice(-3).join(";"));

// Handed around as a value, applied, bound and spread.
const table = [ring, other, viaCall as (...args: unknown[]) => unknown];
other.rope = ropeThatIs(true);
const many = Array.from({ length: 40 }, (_, i) => i);
console.log(table.map(f => JSON.stringify(f.apply(null, ["ab", 5, 6]))).join(" "), JSON.stringify(other.bind(null, "cd")("bound", 1)), (other(...many) as unknown[]).length);
`;

// What the caller knows of an argument may decide the test in front of the early return, for it or against it.
// What the caller asks of the result is answered on each way out of the callee by what that way hands back, and a callee may hand back what its written type rules out.
const results = `let parses = 0;
function unit(v: number | string): number {
  if (typeof v === "number") return v;
  parses++;
  let n = 0;
  for (const c of v) n = n * 10 + (c.charCodeAt(0) - 48);
  return n;
}
let numbers = 0;
for (let i = 0; i < 1000; i++) numbers += unit(3.5);
console.log(numbers, parses);
let texts = 0;
for (let i = 0; i < 1000; i++) texts += unit("12");
console.log(texts, parses);
let mixed = 0;
for (const v of [1, "2", 3.5, "40"]) mixed += unit(v);
console.log(mixed, parses);

// One test throws, and the other is decided against the return.
function pick(k: string | undefined, d: number | string): number | string {
  if (k === undefined) throw new TypeError("no key");
  if (typeof d === "number") return d;
  parses++;
  return k + d;
}
console.log(pick("a", 1), pick("a", "b"), parses);
try {
  pick(undefined, "x");
} catch (error) {
  console.log((error as Error).message, parses);
}

type Holder = { kind: string; n?: number };
const seen: string[] = [];
function lookup(o: Holder): number | string | undefined {
  if (o.kind === "n") return o.n;
  if (o.kind === "none") return undefined;
  seen.push(o.kind);
  return o.kind.length > 3 ? o.kind : o.kind.length;
}
function classify(o: Holder): string {
  const v = lookup(o);
  if (typeof v === "number") return "number " + v;
  return "other " + String(v);
}
console.log(classify({ kind: "n", n: 4 }), classify({ kind: "n" }), classify({ kind: "none" }), classify({ kind: "abc" }), classify({ kind: "abcd" }), seen.join());

// The result, and what was made in front of the call, are read behind both arms.
function explain(o: Holder): string {
  const before = o.kind.length;
  const v = lookup(o);
  let text: string;
  if (typeof v === "number") text = "n" + (v + before);
  else text = "o" + before;
  return text + ":" + String(v);
}
console.log(explain({ kind: "n", n: 4 }), explain({ kind: "none" }), explain({ kind: "abc" }), explain({ kind: "abcd" }), seen.length);

type User = { id: number; cached?: string };
const made: number[] = [];
function nameOf(u: User): string {
  if (u.cached) return u.cached;
  made.push(u.id);
  if (u.id < 0) return u.id as unknown as string;
  u.cached = "user" + u.id;
  return u.cached;
}
function lengthOfName(u: User): number {
  const s = nameOf(u);
  return s.length;
}
function viaTailCall(u: User): string {
  return nameOf(u);
}
const user: User = { id: 7 };
console.log(lengthOfName(user), lengthOfName(user), lengthOfName({ id: -1 }), lengthOfName({ id: 12, cached: "x" }), made.join());
console.log(viaTailCall({ id: -2 }).length, viaTailCall({ id: 3 }).length, made.join());
`;

buildBothWays("arguments of a call that returns early", {
  "each way out of the callee answers what the caller asks of the result": {
    files: { "main.ts": results },
    prints:
      "3500 0\n" +
      "12000 1000\n" +
      "46.5 1002\n" +
      "1 ab 1003\n" +
      "no key 1003\n" +
      "number 4 other undefined other undefined number 3 other abcd abc,abcd\n" +
      "n5:4 o4:undefined n6:3 o4:abcd 4\n" +
      "5 5 undefined 1 7,-1\n" +
      "undefined 5 7,-1,-2,3\n",
  },
  "rest arrays and object literals are the same values wherever the callee goes on": {
    files: { "main.ts": main, "bells.cjs": bells },
    prints:
      "45000 60000 0\n" +
      "undefined abc\n" +
      '[12,"slow","one",2,3] false true 5\n' +
      "undefined gate slow+one+2+3 12;gate slow+one+2+3 12 0 ring\n" +
      "Error: no | at loose | at ring | at callsBroken\n" +
      '10048 16 {"a":5001,"b":"k"} false 1\n' +
      "6 33 1\n" +
      "a b1 xy! 2\n" +
      "object 2 object 1 object [1,2] this object 1+2\n" +
      "one 1|2  7\n" +
      "39997 17 8 north ark 3;north ark 3;south ark 17\n" +
      ' [13,"ab",5,6] "ab56" [8,"cd","bound",1] 41\n',
  },
});
