"use strict";
// Calls of splice with new elements in loops, without a receiver: off a namespace, a variable, by call and apply, bound, optional.
const chunked = { splice(list, start, remove, items) { const end = list.length; start = start < 0 ? (-start > end ? 0 : end + start) : start > end ? end : start; remove = remove > 0 ? remove : 0; const parts = Array.from(items); parts.unshift(start, remove); list.splice(...parts); } };
const { splice } = chunked; const own = Array.prototype.splice; const bound = own.bind([1, 2, 3]);
const answers = []; const say = f => { try { answers.push(JSON.stringify(f())); } catch (error) { answers.push(error.name); } };
function offNamespace(events) { let open = 0; while (open < events.length && open < 9) { if (events[open] === "x") (0, chunked.splice)(events, open, 1, ["a", "b"]); open++; } return events; }
function byName(events) { for (let i = 0; i < events.length && i < 9; i++) { splice(events, i, 1, ["n", i]); i++; } return events; }
function byCall(events) { for (let i = 0; i < events.length && i < 9; i++) { own.call(events, i, 1, "c", i); i++; } return events; }
function byApply(events) { for (let i = 0; i < events.length && i < 9; i++) { own.apply(events, [i, 1, "p", i]); i++; } return events; }
function unbound(events) { for (let i = 0; i < events.length && i < 9; i++) (0, events.splice)(i, 1, "u"); return events; }
function asBound(events) { for (let i = 0; i < events.length && i < 9; i++) bound(i, 0, "b", i); return events; }
function optional(events) { for (let i = 0; i < events.length && i < 9; i++) { events?.splice?.(i, 1, "o", i); i++; } return events; }
function offVariable(events) { const cut = events.splice; for (let i = 0; i < events.length && i < 9; i++) cut(i, 1, "v"); return events; }
function offOther(events, other) { for (let i = 0; i < events.length && i < 9; i++) { other.splice(i, 1, "q", i); i++; } return other; }
function spread(events) { const rest = ["s", 1]; for (let i = 0; i < events.length && i < 9; i++) { events.splice(i, 1, ...rest); i++; } return events; }
function attention(events, context) { let index = -1, steps = 0; while (++index < events.length && steps++ < 12) { if (events[index] === "x") { let open = index; while (open--) { if (events[open] === "a" && context) { const next = []; let offset = 0; next.push("o", events[open], "q"); if (events[index]) { offset = 2; next.push("y"); } else offset = 0; (0, chunked.splice)(events, open - 1, index - open + 3, next); index = open + next.length - offset - 2; break; } } } } index = -1; while (++index < events.length && index < 40) if (events[index] === "x") events[index] = "data"; return events; }
for (let pass = 0; pass < 2; pass++) for (const make of [() => ["a", "x", "b", "x"], () => [], () => ["x"], () => ["a", "a", "x", "x", "c", "x"], () => Object.freeze(["x", "a"]), () => ({ length: 2, 0: "x", 1: "a", splice: own }), () => null]) {
  for (const run of [offNamespace, byName, byCall, byApply, unbound, asBound, optional, offVariable, spread]) say(() => run(make()));
  say(() => offOther(make(), [1, 2, 3])); say(() => attention(make(), {}));
}
console.log(answers.join(" "));
