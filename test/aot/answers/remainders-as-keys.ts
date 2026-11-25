// answers: without-library
// # A remainder is a key. A whole number that the library answers is an index too (0 % -1 is 0). What is no index names a property of a list, and nothing in a typed array or a text.
// # RUN: run-in-shell $SHELL
// # CHECK: 211 of 211 of 211
// # CHECK-NEXT: exited with 0
type Held = { list: (number | string)[]; bytes: Uint8Array; floats: Float64Array; text: string };
function read(held: Held, a: number, b: number): void { report(held.list[a % b]); report(held.bytes[a % b]); report(held.floats[a % b]); report(held.text[a % b]); }
function write(held: Held, a: number, b: number): void { held.bytes[a % b] = 9; held.floats[a % b] = 2.5; held.list[a % b] = "new"; let keys = ""; for (const key in held.list) keys += key + " "; report(keys); for (let at = 0; at < 3; at++) { report(held.bytes[at]); report(held.floats[at]); report(held.list[at]); } }
const pairs = [[0, -1], [7, 2.5], [7, 3], [-7, 3], [-0, 3], [NaN, 3], [3, NaN], [5, 0], [Infinity, 3], [2, Infinity], [2147483648, 3], [4294967295, 4294967296], [9007199254740992, 3], [6, -4], [1.5, 1]];
for (const [a, b] of pairs) { const held: Held = { list: [1, "b", 3], bytes: new Uint8Array([4, 5, 6]), floats: new Float64Array([0.5, 1.5, 2.5]), text: "abc" }; read(held, a, b); write(held, a, b); }
report("end");
declare function report(value: unknown): void;
