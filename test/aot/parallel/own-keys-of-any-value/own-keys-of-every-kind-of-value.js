const out = [];
function keysOf(value) { try { return JSON.stringify(Object.keys(value)); } catch (error) { return error.constructor.name; } }
function namesOf(value) { try { return JSON.stringify(Object.getOwnPropertyNames(value)); } catch (error) { return error.constructor.name; } }
function allOf(value) { try { return Reflect.ownKeys(value).map(String).join(","); } catch (error) { return error.constructor.name; } }
function symbolsOf(value) { try { return Object.getOwnPropertySymbols(value).map(String).join(","); } catch (error) { return error.constructor.name; } }
class Point { x = 1; y = 2; #z = 3; get sum() { return this.x + this.y; } }
const mark = Symbol("mark");
const hidden = Object.defineProperty({ a: 1 }, "b", { value: 2, enumerable: false });
const deleted = { a: 1, b: 2, c: 3 }; delete deleted.b; deleted.b = 4;
const values = [undefined, null, 0, 1.5, NaN, true, "", "abc", 10n, mark, {}, { a: 1, b: 2 }, { 2: "x", a: 1, 1: "y", [mark]: 3 }, [], [1, , 3], new Point(), hidden, deleted, function named(a, b) {}, () => {}, new Map([[1, 2]]), new Proxy({ p: 1 }, { ownKeys() { return ["p", "q"]; }, getOwnPropertyDescriptor(t, k) { return { value: 1, enumerable: k === "q", configurable: true }; } }), Object.create(null), Object.create({ inherited: 1 }), Object.freeze({ f: 1 }), JSON.parse("{\"z\":1,\"a\":2,\"5\":3}"), new String("hi"), /x/g, new Date(0), new Error("e"), Math, globalThis.process ? "process" : "none"];
for (let turn = 0; turn < 3; turn++) for (const value of values) out.push(keysOf(value) + " | " + namesOf(value) + " | " + allOf(value) + " | " + symbolsOf(value));
let sum = 0;
for (let turn = 0; turn < 20000; turn++) { const list = Object.keys(values[11 + (turn & 1)]); list.push("more"); sum += list.length; }
out.push(sum);
console.log(out.join("\n"));
