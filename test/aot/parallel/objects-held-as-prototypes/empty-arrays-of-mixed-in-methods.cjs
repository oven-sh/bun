// COUNTER: operationAOTNewFromData <= 60
// A method that is mixed into another class runs in its slow body: the empty arrays that it makes are made by a stub.
"use strict";
class State { init() { this.depth = -1; this.errors = []; this.stack = []; this.funcs = []; } reset() { this.depth = -1; this.funcs = []; this.errors = []; this.stack = []; return [this.errors, this.stack, []]; } push(x) { this.errors.push(x); this.stack[++this.depth] = x; } }
class Parser { constructor() { this.init(); } }
for (const name of Object.getOwnPropertyNames(State.prototype)) if (name !== "constructor") Object.defineProperty(Parser.prototype, name, Object.getOwnPropertyDescriptor(State.prototype, name));
globalThis.make = () => new Parser();
const parser = globalThis.make(); let total = 0; const kept = new Set();
for (let turn = 0; turn < 400; turn++) {
  const [errors, stack, other] = parser.reset(); kept.add(errors).add(stack).add(other);
  parser.push(turn & 1 ? turn : "x" + turn); parser.push(turn / 2); other.length = turn % 5; other[7] = turn;
  total = (total * 31 + errors.length + stack.length + other.length + (Array.isArray(other) ? 1 : 0) + (Object.getPrototypeOf(stack) === Array.prototype ? 2 : 0)) | 0;
}
console.log(total, kept.size, Object.keys(parser).join(), parser.errors.join(), parser.stack.join());
const lists = parser.reset(); lists[0].push(1.5); lists[1].unshift({}); lists[2].splice(0, 0, "a", undefined); console.log(JSON.stringify(lists), lists[0].concat([], lists[2]).length, Object.isExtensible(lists[0]), lists[0] === lists[1]);
for (const value of [undefined, null, 5, "text", true, Symbol.iterator, 7n]) { try { console.log(String(State.prototype.reset.call(value))); } catch (error) { console.log(error.name); } }
const bare = Object.create(null); State.prototype.reset.call(bare); console.log(Object.keys(bare).join(), bare.errors.length); try { State.prototype.reset.call(Object.freeze({})); } catch (error) { console.log(error.name); }
console.log(JSON.stringify(State.prototype.reset.call(new State())), JSON.stringify(Object.assign(new State(), { errors: 1 }).reset()));
