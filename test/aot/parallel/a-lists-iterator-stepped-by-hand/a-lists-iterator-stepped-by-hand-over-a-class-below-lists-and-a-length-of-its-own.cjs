"use strict";
const parsed = text => JSON.parse(text), said = [], more = process.argv.length > 99 ? 1 : 0;
function drain(it, most) { const out = []; for (let k = 0; k < most; k++) { const r = it.next(); out.push(r.done ? "end" : Array.isArray(r.value) ? "[" + r.value.join() + "]" : String(r.value)); if (r.done) break; } return out.join(" "); }
class Stack extends Array { get top() { return this[this.length - 1]; } }
const stack = Stack.from(parsed("[1,2,3]")); said.push(drain(stack.values(), 9 + more), drain(stack[Symbol.iterator](), 9), String(stack.top));
const frozen = Object.freeze(parsed("[4,5]")); said.push(drain(frozen.entries(), 9));
console.log(said.join("\n"));
