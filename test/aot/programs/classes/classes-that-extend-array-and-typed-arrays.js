// Classes of the program that extend Array, a typed array and ArrayBuffer: the methods they inherit work on their instances, and those that make a new array ask the instance for its constructor and that for its species.
const say = (...values) => console.log(...values);

class List extends Array {}
const list = new List();
say(list.push("a", "b"), list.length, list[1].toUpperCase(), list.pop(), list.indexOf("a"), list.join("-"), String(list), Array.isArray(list), list instanceof List);
say(new List(3).length, new List(1, 2, 3).length, new List("x").length, List.of(7, 8)[1], List.from("abc").length, List.from([1, 2], n => n * 2) instanceof List);
say(list.map(text => text.length) instanceof List, list.filter(Boolean).constructor === List, list.slice().constructor.name, list.concat(["c"]) instanceof List, list.concat(["c"]).length);
list.length = 0;
say(list.length, list[0], JSON.stringify(list), [...new List(1, 2)].length, Object.keys(new List(1, 2)).join());

class Stack extends Array {
  static made = 0;
  #limit;
  name = "stack";
  constructor(limit, ...items) { super(...items); this.#limit = limit; Stack.made++; }
  push(...items) { if (this.length + items.length > this.#limit) throw new RangeError(`over ${this.#limit}`); return super.push(...items); }
  get top() { return this[this.length - 1]; }
  static get [Symbol.species]() { return Array; }
}
const stack = new Stack(3, "x", "y");
say(stack.length, stack.top, stack.push("z"), stack.top.length, stack.name, Stack.made);
try { stack.push("w"); } catch (error) { say(error instanceof RangeError, error.message); }
say(stack.map(text => text + text) instanceof Stack, stack.map(text => text + text).join(), Array.prototype.push.call(stack, "past the limit"), stack.length, Stack.made);

class Made extends Array { static get [Symbol.species]() { return function (length) { Made.asked = length; return { length: 0, made: "by the species" }; }; } }
say(new Made(1, 2, 3).map(n => n).made, Made.asked, new Made(1, 2, 3).filter(() => true).made, Made.asked);
class Joined extends Array { join() { return "the join of the class"; } }
say(String(new Joined(1, 2)), `${new Joined()}`, new Joined(1, 2).toString(), Array.prototype.join.call(new Joined(1, 2)));

class Bytes extends Uint8Array {
  tag = "bytes";
  sum() { let total = 0; for (const byte of this) total += byte; return total; }
}
const bytes = new Bytes(4).fill(3);
say(bytes.sum(), bytes.length, bytes.tag, bytes instanceof Uint8Array, bytes.map(n => n * 2) instanceof Bytes, bytes.map(n => n * 2).sum(), bytes.subarray(1).sum(), bytes.slice(2).tag);
say(new Bytes([1, 2, 300]).sum(), new Bytes(new Set([5, 6])).sum(), new Bytes({ length: 2, 0: 9, 1: { valueOf: () => 1 } }).sum(), new Bytes(new ArrayBuffer(8), 2, 3).length, Bytes.from([1, 2]).sum(), Bytes.of(4).tag);
class Plain extends Float64Array { static get [Symbol.species]() { return Float64Array; } }
say(new Plain([1.5, 2.5]).map(n => n * 2) instanceof Plain, new Plain([1.5, 2.5]).map(n => n * 2)[1]);

class Memory extends ArrayBuffer { get words() { return this.byteLength / 4; } }
say(new Memory(16).words, new Memory(16).slice(4) instanceof Memory, new Memory(16).slice(4).words, new Memory({ valueOf: () => 8 }).words, new Memory(4, { maxByteLength: 8 }).resizable);

say(Reflect.construct(Array, [1, 2, 3], Stack) instanceof Stack, Reflect.construct(Array, [1, 2, 3], Stack).top, Reflect.construct(Array, [1, 2, 3], Stack).name, Reflect.construct(Uint8Array, [2], Bytes).tag, Reflect.construct(List, [2], Object).length);
