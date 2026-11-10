// `function tailPush(list, x) { return list.push(x); }`: strict code: the function leaves by a tail call: where the native method throws, the stack lists the method and not the function.
// Copied in line, with the list known for a list, the call is first tried in line: that try bore no mark of the tail call, and on a frozen list the engine's own push ran and threw under it: `push < tailPush < ..`.
"use strict";
const framesOf = error => error.stack.split("\n").slice(1).map(line => /at (\S+)/.exec(line)?.[1]).filter(name => name && !name.includes("/") && !name.includes(":")).join(" < ");
function tailPush(list, x) { return list.push(x); }
function tailShift(list) { return list.shift(); }
function tailSplice(list) { return list.splice(1, 1); }
function tailFill(list) { return list.fill(0); }
function tailReverse(list) { return list.reverse(); }
function tailPushTwo(list, x) { return list.push(x, x); }
function heldPush(list, x) { const n = list.push(x); return n; }
function attempt(name, f) { try { console.log(name, JSON.stringify(f())); } catch (error) { console.log(name, error.constructor.name, "|", framesOf(error)); } }
const kinds = { frozen: () => Object.freeze([1, 2, 3, 4]), "fixed length": () => Object.defineProperty([1, 2, 3, 4], "length", { writable: false }) };
for (let round = 0; round < 3; round++) {
  for (const [kind, make] of Object.entries(kinds)) {
    const show = round === 2 ? attempt : (name, f) => { try { f(); } catch { } };
    show(kind + " tailPush", () => { const list = make(); return [tailPush(list, 9), list.length]; });
    show(kind + " tailShift", () => { const list = make(); return [tailShift(list), list.length]; });
    show(kind + " tailSplice", () => { const list = make(); return [tailSplice(list), list.length]; });
    show(kind + " tailFill", () => { const list = make(); return [tailFill(list), list.length]; });
    show(kind + " tailReverse", () => { const list = make(); return [tailReverse(list), list.length]; });
    show(kind + " tailPushTwo", () => { const list = make(); return [tailPushTwo(list, 9), list.length]; });
    show(kind + " heldPush", () => { const list = make(); return [heldPush(list, 9), list.length]; });
  }
}
