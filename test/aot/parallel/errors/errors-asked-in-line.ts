// Error.isError() in a program where no class stands below Error: the question is answered in line. Every kind of value, in conditions, filters, loops, with no, several and spread arguments.
import vm from "node:vm";
const values: Record<string, unknown> = {
  nothing: undefined, none: null, yes: true, int: 5, double: 1.5, big: 5n, text: "t", empty: "", symbol: Symbol("s"), fn: () => 1, object: {}, like: { name: "Error", message: "m", stack: "s" }, list: [1], date: new Date(0), regexp: /a/, map: new Map(), view: new Uint8Array(1), boxed: Object(5), bare: Object.create(null),
  error: new Error("e"), unnamed: new Error(), called: Error("c"), type: new TypeError("t"), range: new RangeError("r"), syntax: new SyntaxError("s"), uri: new URIError("u"), evaluation: new EvalError("v"), reference: new ReferenceError("f"), aggregate: new AggregateError([1], "g"), caused: new Error("m", { cause: 1 }),
  proxy: new Proxy(new Error("p"), {}), below: Object.create(new Error("h")), changed: Object.setPrototypeOf(new Error("x"), null), turned: Object.setPrototypeOf({}, new Error("y")), frozen: Object.freeze(new Error("z")), dom: new DOMException("m", "AbortError"), other: vm.runInNewContext("new TypeError('r')"), otherObject: vm.runInNewContext("({})"), cloned: structuredClone(new RangeError("k")), thrown: (() => { try { return (null as any).x; } catch (error) { return error; } })(), parsed: (() => { try { return JSON.parse("{"); } catch (error) { return error; } })(),
};
const entries = Object.entries(values), list = Object.values(values);
function asked(value: unknown) { return Error.isError(value); }
function branch(value: unknown) { if (Error.isError(value)) return "E" + String(value.message).length; return "-"; }
function negated(value: unknown) { return !Error.isError(value) || value === list[0] ? "a" : "b"; }
function typed(value: Error) { return Error.isError(value) ? 1 : 0; }
function counted(items: unknown[]) { let r = 0; for (let i = 0; i < items.length; i++) { if (Error.isError(items[i])) r += i; else r -= 1; } return r; }
function stored(items: unknown[]) { const seen: boolean[] = []; for (const item of items) { const is = Error.isError(item); seen.push(is, !is); } return seen.filter(Boolean).length; }
for (let turn = 0; turn < 4; turn++) {
  let text = "";
  for (const [name, value] of entries) text += name + asked(value) + branch(value) + negated(value) + " ";
  console.log(text);
  console.log(counted(list), stored(list), typed(new Error("a")), typed({ name: "n", message: "m" }), list.filter(value => Error.isError(value)).length, list.findIndex(value => Error.isError(value)), list.map(value => Error.isError(value) ? 1 : 0).join(""));
}
let order = "";
const second = (Error as any).isError((order += "a", new Error("a")), (order += "b", 1));
console.log(second, order, (Error as any).isError(), typeof Error.isError(5), Error.isError(...([new Error("s")] as [Error])));
