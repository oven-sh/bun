// answers: without-library
// # `callee.apply(t, list)` and `Reflect.apply(callee, t, list)` where nothing is proven of the list: what turns out to be an array goes on as it is, and the stub of the call copies its elements onto the stack once.
// # Whatever else comes is read first, as apply reads it, into a list of its own. The two arms meet in front of ONE CallList, in tail position and out of it.
// # Made anew element by element in front of every call, a list of 70 cost 10,000 instructions a call. No callee gets the caller's array for its rest parameter, and what the callee does to the array changes no argument.
// # A rest parameter and what stands for `arguments` of over 127 values lie in storage beside the cell, written in one go.
// # f1 = tail, f2 = inside, f3 = reflected
// # LIBRARY: own
// # RUN(TAIL): walk f1 mechanisms=all
// # TAIL-LABEL: code f1:Body
// # TAIL: [[isArray]]: boolean @Boolean = TypeTest {{*}}testedType=Array
// # TAIL: = Narrowed {{*}}, [[isArray]]
// # TAIL: = NewArgumentList
// # TAIL: ([[list]]: Array{{*}} @Cell
// # TAIL-NEXT: = CallList {{*}}, [[list]] {{*}} tail
// # TAIL-NEXT: ReturnCall
// # RUN(INSIDE): walk f2 mechanisms=all
// # INSIDE-LABEL: code f2:Body
// # INSIDE: = TypeTest {{*}}testedType=Array
// # INSIDE: = NewArgumentList
// # INSIDE: ([[list]]: Array{{*}} @Cell
// # INSIDE-NEXT: = CallList {{*}}, [[list]]
// # RUN(WITHHELD): walk f2 mechanisms=all-Guesses
// # WITHHELD-NOT: testedType=Array
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 221 of 221 of 221
// # CHECK-NEXT: exited with 0
function tell(deed) { try { report(deed()); } catch (error) { report(error.constructor.name); } }
function tail(callee, list) { "use strict"; return callee.apply(null, list); }
function inside(callee, list) { const answer = callee.apply(null, list); return answer; }
function reflected(callee, list) { "use strict"; return Reflect.apply(callee, null, list); }
function show() { let text = String(arguments.length); for (let i = 0; i < arguments.length; i++) text += "," + String(arguments[i]); return text; }
function keep(...all) { all[0] = "changed"; all[all.length] = "more"; let text = String(all.length); for (let i = 0; i < all.length; i++) text += "|" + String(all[i]); return text; }
function first(a) { return String(a); }
function ownArguments() { return arguments; }
function withGetter() { const list = [1, 2]; Object.defineProperty(list, 0, { get() { return "got"; } }); return list; }
class Row extends Array {}
function row() { const list = new Row(2); list[0] = 1; list[1] = 2; return list; }
function sparse() { const list = [1]; list[200000] = 0; list.length = 3; return list; }
const makers = [() => [1, 2, 3], () => [1, , 3], () => [1.5, 2.5], () => [1.5, , 2.5], () => [], () => new Array(3), () => ({ length: 2, 0: "a", 1: "b" }), () => ownArguments(7, 8), () => new Uint8Array([4, 5]), () => null, () => undefined, () => 5, () => "ab", withGetter, row, sparse, () => Object.freeze([1, 2]), () => [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]];
const calls = [tail, inside, reflected];
const callees = [show, keep, first];
for (let m = 0; m < makers.length; m++) { for (let c = 0; c < calls.length; c++) { for (let f = 0; f < callees.length; f++) { tell(() => calls[c](callees[f], makers[m]())); } } }
function text(list) { let all = String(list.length); for (let i = 0; i < list.length; i++) all += "|" + String(list[i]); return all; }
const kept = [1, 2, 3];
tell(() => tail(keep, kept) + "/" + text(kept));
tell(() => inside(keep, kept) + "/" + text(kept));
tell(() => reflected(keep, kept) + "/" + text(kept));
const shared = [1, 2, 3];
function changes(a, b, c) { shared[0] = 100; shared.length = 1; return a + b + c; }
tell(() => inside(changes, shared) + "/" + text(shared));
function long(n) { const list = []; for (let i = 0; i < n; i++) list[i] = i % 3 === 0 ? i : i % 3 === 1 ? i + 0.5 : "t" + i; return list; }
function ends(...all) { all[all.length] = "last"; return all.length + ":" + String(all[0]) + ":" + String(all[1]) + ":" + String(all[all.length - 2]) + ":" + String(all[all.length - 1]) + ":" + Array.isArray(all); }
function endsOfArguments() { return arguments.length + ":" + String(arguments[0]) + ":" + String(arguments[1]) + ":" + String(arguments[arguments.length - 1]); }
const lengths = [4, 5, 126, 127, 128, 129, 200, 1000, 5000];
for (let n = 0; n < lengths.length; n++) { for (let c = 0; c < calls.length; c++) { tell(() => calls[c](ends, long(lengths[n]))); tell(() => calls[c](endsOfArguments, long(lengths[n]))); } }
report("end");
