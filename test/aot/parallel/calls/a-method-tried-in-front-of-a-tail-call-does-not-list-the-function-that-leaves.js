// `function lastShift(holder) { return holder.it.shift(); }`: strict code, and lists are seen to arrive under `it`: in front of the tail call the built-in's method is tried on the receiver as it stands.
// What the tried method throws is thrown inside the callee: the function has left, as where the call is made: the stack lists the method and not the function.
"use strict";
const framesOf = error => error.stack.split("\n").slice(1).map(line => /at (\S+)/.exec(line)?.[1]).filter(name => name && !name.includes("/") && !name.includes(":")).join(" < ").split(" < attempt")[0];
function lastPop(holder) { return holder.it.pop(); }
function lastShift(holder) { return holder.it.shift(); }
function lastUnshift(holder) { return holder.it.unshift(9); }
function lastPush(holder) { return holder.it.push(9); }
function lastJoin(holder) { return holder.it.join(holder.between); }
function keptShift(holder) { const n = holder.it.shift(); return n + 0; }
function keptPush(holder) { const n = holder.it.push(9); return n + 0; }
function attempt(name, f) { try { console.log(name, JSON.stringify(f())); } catch (error) { console.log(name, error.constructor.name, "|", framesOf(error)); } }
const kinds = {
  frozen: () => Object.freeze([1, 2, 3, 4]), sealed: () => Object.seal([1, 2, 3, 4]), closed: () => Object.preventExtensions([1, 2, 3, 4]),
  "fixed length": () => Object.defineProperty([1, 2, 3, 4], "length", { writable: false }), free: () => [1, 2, 3, 4],
};
const all = [lastPop, lastShift, lastUnshift, lastPush, lastJoin, keptShift, keptPush];
const between = { toString: function textOf() { throw new Error("no"); } };
for (const f of all) f({ it: [1, 2, 3], between: "-" });
for (let round = 0; round < 3; round++) {
  for (const [kind, make] of Object.entries(kinds)) {
    const show = round === 2 ? attempt : (name, f) => { try { f(); } catch { } };
    for (const f of all) show(kind + " " + f.name, () => { const list = make(); return [f(JSON.parse("[1]")[0] ? { it: list, between } : null), list]; });
  }
}
