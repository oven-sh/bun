// `new Array()` behaves like `[]`: empty, grows by index and by push, takes any kind of value, and is a new list each time.
const out: string[] = [];
const show = (label: string, list: unknown[]) => out.push(`${label}: ${list.length} ${JSON.stringify(list)} ${Array.isArray(list)} ${Object.getPrototypeOf(list) === Array.prototype}`);
function integers(n: number): number[] { const list: number[] = new Array(); for (let k = 0; k < n; k++) list[k] = (k * 3) | 0; return list; }
function fractions(n: number): number[] { const list = new Array<number>(); for (let k = 0; k < n; k++) list.push(k / 2); return list; }
function mixed(): unknown[] { const list = new Array(); list[0] = 1; list[1] = "two"; list[3] = { three: 3 }; return list; }
const state: { words: number[] } = { words: [] };
function refill(seed: number): void { const words: number[] = (state.words = new Array()); for (let k = 0; k < 16; k++) words[k] = (seed + k * 40503) | 0; }
show("none", new Array());
show("integers", integers(0)); show("integers", integers(1)); show("integers", integers(20));
show("fractions", fractions(5));
show("mixed", mixed());
refill(7); show("words", state.words);
const first = integers(3), second = integers(3); first[0] = 99; show("first", first); show("second", second);
show("length given", new Array(3)); show("elements given", new Array(1, 2, 3)); show("text given", new Array("3"));
class Stack extends Array<number> {}
show("below", new Stack());
{ const Array = function () { return ["shadowed"]; } as unknown as ArrayConstructor; show("shadowed", new Array()); }
console.log(out.join("\n"));
