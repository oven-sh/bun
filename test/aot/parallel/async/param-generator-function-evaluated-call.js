// A call of a generator function evaluates the defaults and the patterns of its parameters and only then hands back the generator. What they read is changed
// between the call and the first next(). The generators are short, long, call themselves, hold a try, and are stepped by hand or by a loop.
let step = 1;
const box = { v: 1 };
const sink = [];
function read() { return step; }

function* short(by = step) { yield by; }
function* fromField(by = box.v) { yield by; }
function* fromPattern({ v }) { yield v; }
function* fromList([first]) { yield first; }
function* fromEarlierParameter(o, by = o.v) { yield by; }
function* fromLength(list, n = list.length) { yield n; }
function* fromNested({ inner: { v } }) { yield v; }
function* fromCall(by = read()) { yield by; }
function* callsItself(depth, by = step) { yield by; if (depth > 0) yield* callsItself(depth - 1); }
function* withFinally(by = step) { try { yield by; yield by + 1; } finally { sink.length = 0; } }
function* withCatch(by = step) { try { yield by; } catch (e) { yield -1; } }
function* delegates(by = step) { yield* [by, by + 1]; }
function* long(by = step) {
  let t = by;
  for (let i = 0; i < 3; i++) { t += i; yield t; t *= 2; yield t; t -= 3; yield t; t ^= 5; yield t; t += 7; yield t; t |= 1; yield t; t %= 1000; yield t; t += 11; yield t; }
  for (let i = 0; i < 3; i++) { t += i * 2; yield t; t *= 3; yield t; t -= 5; yield t; t ^= 9; yield t; t += 13; yield t; t |= 2; yield t; t %= 977; yield t; t += 17; yield t; }
  for (let i = 0; i < 3; i++) { t += i * 3; yield t; t *= 5; yield t; t -= 7; yield t; t ^= 3; yield t; t += 19; yield t; t |= 4; yield t; t %= 991; yield t; t += 23; yield t; }
}
class Holder { v = 1; *fromThis(by = this.v) { yield by; } static *fromStatic(by = Holder.s) { yield by; } static s = 1; }
const methods = { v: 1, *fromThis(by = this.v) { yield by; } };

const topLevel = callsItself(1);
step = 2;
const lines = ["at the top " + topLevel.next().value];

function ofItself() { step = 1; const it = callsItself(2); step = 2; return it.next().value; }
function ofLong() { step = 1; const it = long(); step = 2; return it.next().value; }
function ofLongInLoop(stop) { step = 1; const it = long(); step = 2; let sum = 0; for (const v of it) { sum += v; if (sum > stop) break; } return sum; }
function ofFinally() { step = 1; const it = withFinally(); step = 2; return it.next().value; }
function ofCatch() { step = 1; const it = withCatch(); step = 2; return it.next().value; }
function ofDelegate() { step = 1; const it = delegates(); step = 2; return it.next().value; }
function ofShortByHand() { step = 1; const it = short(); step = 2; const first = it.next(), second = it.next(); return first.value + ":" + second.done; }
function ofCall() { step = 1; const it = fromCall(); step = 2; return it.next().value; }
function field() { box.v = 1; const it = fromField(); box.v = 2; return it.next().value; }
function pattern() { const o = { v: 1 }; const it = fromPattern(o); o.v = 2; return it.next().value; }
function list() { const l = [1]; const it = fromList(l); l[0] = 2; return it.next().value; }
function earlier() { const o = { v: 1 }; const it = fromEarlierParameter(o); o.v = 2; return it.next().value; }
function length() { const l = [1]; const it = fromLength(l); l.push(2); return it.next().value; }
function nested() { const o = { inner: { v: 1 } }; const it = fromNested(o); o.inner = { v: 2 }; return it.next().value; }
function ofInstance() { const h = new Holder(); const it = h.fromThis(); h.v = 2; return it.next().value; }
function ofClass() { Holder.s = 1; const it = Holder.fromStatic(); Holder.s = 2; return it.next().value; }
function ofObject() { methods.v = 1; const it = methods.fromThis(); methods.v = 2; return it.next().value; }
function throwsAtTheCall() { let it; try { it = fromNested({}); } catch (e) { return "at the call " + e.constructor.name; } try { it.next(); } catch (e) { return "at next " + e.constructor.name; } return "nowhere"; }

const seen = new Set();
for (let turn = 0; turn < 2000; turn++) {
  seen.add([
    ofItself(), ofLong(), ofLongInLoop(50), ofFinally(), ofCatch(), ofDelegate(), ofShortByHand(), ofCall(),
    field(), pattern(), list(), earlier(), length(), nested(), ofInstance(), ofClass(), ofObject(), throwsAtTheCall(),
  ].join(" "));
}
console.log(lines.concat([...seen]).join("\n"));
