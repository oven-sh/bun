// answers: with-library
// # text.toLocaleUpperCase(): what native code answers is held against the row of the built-in in the code of the call, in every build. That check made a boolean of its test (two blocks, a phi) and branched on the phi at once;
// # the threading of jumps emptied all three blocks again, at every such call. It branches on the test itself: on to the continuation, or to the stop. Where the row says a whole number or something else, it asks for the int32
// # first and for the rest only where that fails.
// # RUN(UPPER): emit f1 mechanisms=all
// # REQUIRES(UPPER): as-written
// # UPPER-NOT: = Phi
// # UPPER: without position:
// # RUN(NORMAL): emit f2 mechanisms=all
// # REQUIRES(NORMAL): as-written
// # NORMAL-NOT: = Phi
// # NORMAL: without position:
// # Answers of every kind that a row names: a text, undefined or a text, a whole number, a whole number or undefined, a number that is none, a list, an object of a built-in class, a boolean.
// # RUN: run-in-shell $SHELL
// # CHECK: 17 of 17 of 17
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;

function upper(text: string) { return text.toLocaleUpperCase(); }
function normal(text: string) { return text.normalize("NFC"); }
function shows(value: unknown) { return JSON.stringify(value); }
function pointAt(text: string, at: number) { return text.codePointAt(at); }
function compares(a: string, b: string) { return a.localeCompare(b); }
function joins(list: unknown[]) { return list.join("-"); }
function fixed(a: number) { return a.toFixed(2); }
function parses(text: string) { return parseFloat(text); }
function timeOf(ms: number) { return new Date(ms).getTime(); }
function keysOf(of: object) { return Object.keys(of); }
function isWhole(value: unknown) { return Number.isSafeInteger(value); }
const outside = JSON.parse('["a","straße","\\u00e9","e\\u0301","","\\ud83d\\ude00x",{"a":1,"b":[2]},[1,null,"x"],7,1.5,-0.0,9007199254740993,null,true]');
for (const value of outside) report([typeof value === "string" ? [upper(value), normal(value).length, pointAt(value, 0), pointAt(value, 1), pointAt(value, 9), compares(value, "b"), parses(value)].join() : "no text", shows(value), isWhole(value), typeof value === "number" ? [fixed(value), timeOf(value)].join() : "no number", value && typeof value === "object" ? [keysOf(value).join("+"), Array.isArray(value) ? joins(value) : "no list"].join() : "no object"].join(" | "));
report([shows(undefined), shows(() => 1), shows(Symbol.iterator), timeOf(NaN), timeOf(8.64e15), timeOf(8.64e15 + 1), parses("x"), parses("1e400"), parses("-0")].map(String).join());
let sum = 0;
for (let turn = 0; turn < 30000; turn++) sum += upper(outside[turn & 3]).length + (pointAt(outside[turn % 6], turn & 1) ?? -1) + (shows(outside[turn % 14]) ?? "").length;
report(sum);
report("end");
