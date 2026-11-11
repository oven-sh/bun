// A frozen list, a sealed one, one that takes no more and one whose length is fixed refuse pop, shift, unshift and push: the TypeError's stack lists the method, as for any native function that throws,
// and a function that left by a tail call of the method is not listed: whether the list's class is known, is only seen to arrive, or nothing is known of the receiver, and where the method is called by value.
"use strict";
const framesOf = error => error.stack.split("\n").slice(1).map(line => /at (\S+)/.exec(line)?.[1]).filter(name => name && !name.includes("/") && !name.includes(":")).join(" < ").split(" < attempt")[0];
function lastPop(list) { return list.pop(); }
function lastShift(list) { return list.shift(); }
function lastUnshift(list, x) { return list.unshift(x); }
function lastPush(list, x) { return list.push(x); }
function keptPop(list) { const n = list.pop(); return n + 0; }
function keptShift(list) { const n = list.shift(); return n + 0; }
function keptUnshift(list, x) { const n = list.unshift(x); return n + 0; }
function keptPush(list, x) { const n = list.push(x); return n + 0; }
function lastPopOfAny(holder) { return holder.it.pop(); }
function lastShiftOfAny(holder) { return holder.it.shift(); }
function lastUnshiftOfAny(holder) { return holder.it.unshift(9); }
function lastPushOfAny(holder) { return holder.it.push(9); }
const byValue = { pop: [].pop, shift: [].shift, unshift: [].unshift, push: [].push };
function lastCalled(name, list) { return byValue[name].call(list, 9); }
function keptCalled(name, list) { const n = byValue[name].call(list, 9); return n + 0; }
function attempt(name, f) { try { console.log(name, JSON.stringify(f())); } catch (error) { console.log(name, error.constructor.name, "|", framesOf(error)); } }
const kinds = {
  frozen: () => Object.freeze([1, 2, 3, 4]), sealed: () => Object.seal([1, 2, 3, 4]), closed: () => Object.preventExtensions([1, 2, 3, 4]),
  "fixed length": () => Object.defineProperty([1, 2, 3, 4], "length", { writable: false }), "empty, fixed length": () => Object.defineProperty([], "length", { writable: false }),
  "frozen, empty": () => Object.freeze([]), holed: () => [1, 2, , ], free: () => [1, 2, 3, 4], empty: () => [],
};
const anyOf = [lastPopOfAny, lastShiftOfAny, lastUnshiftOfAny, lastPushOfAny];
for (let round = 0; round < 3; round++) {
  for (const [kind, make] of Object.entries(kinds)) {
    const show = round === 2 ? attempt : (name, f) => { try { f(); } catch { } };
    show(kind + " lastPop", () => { const list = make(); return [lastPop(list), list]; });
    show(kind + " lastShift", () => { const list = make(); return [lastShift(list), list]; });
    show(kind + " lastUnshift", () => { const list = make(); return [lastUnshift(list, 9), list]; });
    show(kind + " lastPush", () => { const list = make(); return [lastPush(list, 9), list]; });
    show(kind + " keptPop", () => { const list = make(); return [keptPop(list), list]; });
    show(kind + " keptShift", () => { const list = make(); return [keptShift(list), list]; });
    show(kind + " keptUnshift", () => { const list = make(); return [keptUnshift(list, 9), list]; });
    show(kind + " keptPush", () => { const list = make(); return [keptPush(list, 9), list]; });
    for (const f of anyOf) show(kind + " " + f.name, () => { const list = make(); return [f(JSON.parse("[1]")[0] ? { it: list } : null), list]; });
    for (const name of Object.keys(byValue)) {
      show(kind + " lastCalled " + name, () => { const list = make(); return [lastCalled(name, list), list]; });
      show(kind + " keptCalled " + name, () => { const list = make(); return [keptCalled(name, list), list]; });
    }
  }
}
