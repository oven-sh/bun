// includes | indexOf over every kind of storage, every kind of searched value and every kind of start, on arrays and on what only looks like one.
const launder = new Function("v", process.env.LAUNDER_TEXT ?? "return v") as <V>(v: V) => V;
const show = (label: string, ...values: unknown[]) => console.log(label, values.map((v) => (Object.is(v, -0) ? "-0" : String(v))).join(" "));
const shared = { name: "shared" };
const lists: [string, unknown[]][] = [
  ["empty", []],
  ["int32", [1, 2, 3, 2, 1]],
  ["doubles", [0.5, 1.5, NaN, -0, 1.5]],
  ["texts", ["a", "b", "ab", "a" + launder("b"), ""]],
  ["boxed", [1, "1", null, undefined, shared, NaN, -0, true, 10n, Symbol.iterator]],
  ["holes in int32", [1, , 3, , 5]],
  ["holes in doubles", [0.5, , 2.5]],
  ["holes in boxed", ["a", , shared, ,]],
  ["holes alone", new Array(4)],
  ["from unseen code", launder(JSON.parse('[1,"x",null,2.5,[1]]'))],
  ["sparse", (() => { const list: unknown[] = [1, 2]; list[100000] = "far"; return list; })()],
  ["frozen", Object.freeze([1, 2, 3]) as unknown[]],
];
const searched: unknown[] = [1, 2, 3, 5, 0.5, 1.5, 2.5, NaN, 0, -0, "a", "ab", "1", "", "far", null, undefined, shared, { name: "shared" }, true, 10n, Symbol.iterator];
const starts: (number | undefined)[] = [undefined, 0, -0, 1, 2, 4, 5, 6, 100, -1, -2, -5, -6, -100, 0.9, 1.9, -0.9, -1.9, NaN, Infinity, -Infinity, 4294967295, 4294967296, -4294967296, 9007199254740991];
for (const [label, list] of lists) {
  for (const value of searched) {
    const found: string[] = [];
    for (const start of starts) found.push((list.includes(value, start) ? "y" : "n") + list.indexOf(value, start));
    show(label + " | " + typeof value + " " + String(typeof value === "object" && value ? "object" : typeof value === "symbol" ? "symbol" : Object.is(value, -0) ? "-0" : value), found.join(","));
  }
}
function onAnything(label: string, receiver: unknown, value: unknown, start?: unknown) {
  let answers: string;
  try { answers = String(Array.prototype.includes.call(receiver, value, start as number)) + " " + String(Array.prototype.indexOf.call(receiver, value, start as number)); } catch (error) { answers = (error as Error).constructor.name; }
  show(label, answers);
}
onAnything("object", { length: 3, 0: "a", 1: "b", 2: "c" }, "c");
onAnything("object, length is text", { length: "2", 0: "a", 1: "b", 2: "c" }, "c");
onAnything("object, length is a fraction", { length: 2.9, 0: "a", 1: "b", 2: "c" }, "c");
onAnything("object, length is negative", { length: -1, 0: "a" }, "a");
onAnything("object, length beyond 2 ** 32", { length: 4294967297, 4294967296: "far" }, "far", 4294967290);
onAnything("object, length is 2 ** 53 - 1", { length: 9007199254740991, 9007199254740990: "last" }, "last", -3);
onAnything("object without a length", {}, undefined);
onAnything("object, missing members", { length: 2 }, undefined);
onAnything("text", "abc", "c");
onAnything("number", 5, 5);
onAnything("boolean", true, true);
onAnything("typed array", new Uint8Array([1, 2, 3]), 3);
onAnything("arguments", (function (..._: unknown[]) { return arguments; })(1, 2, 3), 3);
onAnything("undefined", undefined, 1);
onAnything("null", null, 1);
onAnything("the start is an object", [1, 2, 3], 3, { valueOf() { return 1; } });
onAnything("the start shrinks the array", (() => { const list = [1, 2, 3, 4]; return list; })(), 4, { valueOf() { return 0; } });
const shrinking = [1, 2, 3, 4];
show("shrunk by the start", shrinking.includes(4, { valueOf() { shrinking.length = 2; return 0; } } as unknown as number), shrinking.indexOf(2, { valueOf() { shrinking.length = 1; return 0; } } as unknown as number));
const changing: unknown[] = [1, 2, 3];
show("turned to doubles by the start", changing.includes(0.5, { valueOf() { changing[1] = 0.5; return 0; } } as unknown as number), changing.indexOf(0.5));
class Derived extends Array<number> {}
const derived = Derived.from([1, 2, 3]);
show("derived", derived.includes(3), derived.indexOf(3), derived.includes(4));
const inheriting: unknown[] = [1, , 3];
Object.setPrototypeOf(inheriting, { 1: "inherited", __proto__: Array.prototype });
show("inherits an element", inheriting.includes("inherited"), inheriting.indexOf("inherited"), inheriting.includes(undefined));
