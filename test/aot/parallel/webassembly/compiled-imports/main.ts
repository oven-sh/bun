// A module calls functions of JavaScript that were compiled: with fewer, as many and more arguments than they take, in registers and on the stack, and functions that were not.
// STATISTIC on x64: WasmImportStubsCallingClosures = 9
// COUNTER in every build: WasmInstancesInterpreted = 0
/// <reference path="../wasm-files.d.ts" />
import path from "./module.wasm";

const bytes = new Uint8Array(await Bun.file(path).arrayBuffer());
const compiled = new WebAssembly.Module(bytes);
const lines: string[] = [];
const show = (value: unknown): string => (Object.is(value, -0) ? "-0" : typeof value === "function" ? "function" : typeof value === "object" && value ? JSON.stringify(value) : String(value));
function outcomeOf(run: () => unknown): string {
  try {
    return show(run());
  } catch (error) {
    const { name, message } = error as Error;
    const hint = message.indexOf(" (evaluating");
    return name + ": " + (hint < 0 ? message : message.slice(0, hint));
  }
}
const note = (name: string, values: unknown[]) => void lines.push(name + "(" + values.map(show).join() + ")");

class Receiver {
  count = 0;
  static takes(a: number) { note("static", [a, this === undefined || this === (globalThis as unknown)]); return a * 2; }
}
let reentered = 0;
let e: any;
const closures: Record<string, Function> = {
  zero() { note("zero", []); return 7; },
  one(a: number, b = 5, ...rest: number[]) { note("one", [a, b, rest, arguments.length]); return a + b; },
  three(a: number) { note("three", [a, arguments.length, arguments[2], this === undefined || this === (globalThis as unknown)]); return -0.5; },
  four: (a: number, b: number, c: number, d: number, missing?: unknown) => note("four", [a, b, c, d, missing]),
  five(a: number, b: number, c: number, d: number, f: number) { note("five", [a, b, c, d, f]); return a - b + c - d + f; },
  ten(a: number, b: number, c: number, d: number, f: number, g: number, h: number, i: number, j: number, k: number) { return (a ^ b ^ c ^ d ^ f ^ g ^ h ^ i ^ j ^ k) | 0; },
  mixed: (a: unknown, b: number, c: number, d: number, f: number, g: unknown, h: unknown, i: number) => (note("mixed", [a, b, c, d, f, g, h, i]), [g, h, b + i]),
  sixteen: (...all: number[]) => (note("sixteen", all), all.length),
  seventeen: (...all: number[]) => (note("seventeen", all), all.length),
  wide: (a: number, b: number) => a / b,
  pair: (a: number) => [a, a + 1],
};
const make = (over: Record<string, unknown>) => new WebAssembly.Instance(compiled, { env: { ...closures, ...over } as any }).exports as any;
e = make({});
const all = (exports: any) => {
  const results = [
    outcomeOf(() => exports.callZero()), outcomeOf(() => exports.callOne(-1)), outcomeOf(() => exports.callThree(1, 2, 4294967295)), outcomeOf(() => exports.callFour(1, 2, 3, -4)),
    outcomeOf(() => exports.callFive(1, 2, 3, 4, 2147483648)), outcomeOf(() => exports.callTen(1, -2, 3, -4, 5, -6, 7, -8, 9, -2147483648)),
    outcomeOf(() => exports.callMixed("text", 1, -2, 3, -4, { object: 1 }, undefined, -2147483648)), outcomeOf(() => exports.callSixteen(...Array.from({ length: 16 }, (_, i) => i * -3))),
    outcomeOf(() => exports.callSeventeen(...Array.from({ length: 17 }, (_, i) => i - 9))), outcomeOf(() => exports.callWide(1.5, 4)), outcomeOf(() => exports.callPair(6)),
  ];
  console.log(results.join(" | "));
  console.log(lines.splice(0).join(" "));
};
all(e);
console.log(e.sumOfTens(1), e.sumOfTens(2), e.sumOfTens(20000));

// Functions that are no such closure.
const withProperties = Object.assign((a: number) => a + 100, { tag: 1 });
const others: [string, unknown][] = [
  ["bound", function (this: unknown, a: number, b: number) { note("bound", [this, a, b]); return 3; }.bind("receiver", 9)],
  ["native", Math.max],
  ["class", Receiver],
  ["static", Receiver.takes],
  ["properties", withProperties],
  ["proxy", new Proxy((a: number) => a + 1, { apply: (target, receiver, list) => (note("apply", [receiver === undefined, list]), target(list[0])) })],
  ["async", async (a: number) => a],
  ["generator", function* (a: number) { yield a; }],
  ["throws", (a: number) => { throw new TypeError("thrown for " + a); }],
  ["many parameters", (a: number, b: unknown, c: unknown, d: unknown, f: unknown, g: unknown, h: unknown) => (note("many", [a, b, c, d, f, g, h]), 4)],
  ["new.target", function (a: number) { note("new.target", [new.target, a]); return 5; }],
  ["symbol", () => Symbol.iterator],
  ["returns text", () => "12"],
  ["getter", Object.getOwnPropertyDescriptor(class { static get value() { note("getter", [this === undefined]); return 6; } }, "value")!.get],
];
for (const [name, other] of others) {
  const exports = make({ one: other, three: other, five: other, ten: other, mixed: other });
  console.log(name, [outcomeOf(() => exports.callOne(8)), outcomeOf(() => exports.callThree(1, 2, 3)), outcomeOf(() => exports.callFive(5, 4, 3, 2, 1)), outcomeOf(() => exports.callTen(9, 8, 7, 6, 5, 4, 3, 2, 1, 0)), outcomeOf(() => exports.callMixed(null, 1, 2, 3, 4, 5, 6.5, 7))].join(" | "));
  console.log(lines.splice(0).join(" "));
}

const exported = make({ one: e.callOne });
console.log("exported", exported.callOne(8), lines.splice(0).join(" "));

// The closure calls the module again, throws through several of its frames, and overflows the stack.
const nested = make({
  ten: (a: number, b: number, c: number, d: number, f: number, g: number, h: number, i: number, j: number, k: number): number => {
    if (a > 0)
      return nested.callTen(a - 1, b, c, d, f, g, h, i, j, k + 1) + 1;
    if (b)
      throw new RangeError("at the bottom: " + [b, c, d, f, g, h, i, j, k].join());
    return k;
  },
  one: (a: number): number => (++reentered, nested.callOne(a + 1) + 1),
});
console.log(nested.callTen(50, 0, 1, 2, 3, 4, 5, 6, 7, 8), outcomeOf(() => nested.callTen(50, 1, 1, 2, 3, 4, 5, 6, 7, 8)));
console.log(outcomeOf(() => nested.callOne(1)), reentered > 100, nested.callTen(3, 0, 0, 0, 0, 0, 0, 0, 0, 1));
let frames: string[] = [];
const traced = make({ five: function named(a: number, b: number, c: number, d: number, f: number) { frames = new Error("here").stack!.split("\n").slice(0, 2).map(line => line.trim().split(" ").slice(0, 2).join(" ")); return 0; } });
traced.callFive(1, 2, 3, 4, 5);
console.log(frames.join(" / "));

// A collection while the arguments stand in the stub's frame alone.
const kept = make({ mixed: (a: unknown, b: number, c: number, d: number, f: number, g: any, h: any, i: number) => { let list: unknown[] = []; for (let n = 0; n < 3000; ++n) list.push({ n, text: "t" + n }); Bun.gc(true); return [a, g.text, h.text, list.length, b + c + d + f + i]; } });
for (let n = 0; n < 4; ++n)
  console.log(show(kept.callMixed({ first: n }, 1, 2, 3, 4, { text: "g" + n }, { text: "h" + n }, 5)));
// A number that is stored where the argument was: other bits of the caller's word do not count.
const bits = make({ ten: (...values: number[]) => (note("bits", values), values.length) });
console.log(bits.sumOfTens(3), lines.splice(0).join(" "));
