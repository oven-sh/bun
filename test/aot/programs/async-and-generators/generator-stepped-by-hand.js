const lines = [];
function log(...parts) { lines.push(parts.map(String).join(" ")); }

function* counts(n) { for (let i = 0; i < n; i++) yield i; return "end"; }
function* echoes() { let received = yield "first"; for (;;) received = yield "got " + received; }
function* guarded(trace) {
  try { yield 1; yield 2; } catch (error) { trace.push("caught " + error); yield 3; } finally { trace.push("finally"); }
  return 4;
}
function* throwsAtSecond() { yield 1; throw new Error("second"); }

function sumByHand(n) { const g = counts(n); let s = 0; for (;;) { const r = g.next(); if (r.done) return s + ":" + r.value; s += r.value; } }
function stepThenLoop(n) { const g = counts(n); const first = g.next().value; let s = 0; for (const v of g) s += v; return first + ":" + s; }
function loopThenStep(n) { const g = counts(n); let s = 0; for (const v of g) { s += v; if (v === 2) break; } const after = g.next(); return s + ":" + after.done + ":" + after.value; }
function afterTheEnd() { const g = counts(1); return [g.next(), g.next(), g.next(), g.next()].map(r => r.done + "/" + r.value).join(" "); }
function sendsValues() { const g = echoes(); const out = [g.next("lost").value]; for (let i = 0; i < 3; i++) out.push(g.next(i).value); return out.join(","); }
function observableArgument() { const g = echoes(); const order = []; g.next(); const r = g.next((order.push("argument"), "x")); order.push(r.value); return order.join(","); }
function returnsEarly() { const trace = []; const g = guarded(trace); const a = g.next(); const b = g.return("out"); const c = g.next(); return [a.value, b.value, b.done, c.value, c.done, trace.join("|")].join(","); }
function throwsIn() { const trace = []; const g = guarded(trace); g.next(); const a = g.throw("boom"); const b = g.next(); const c = g.next(); return [a.value, a.done, b.value, b.done, c.value, c.done, trace.join("|")].join(","); }
function throwsBeforeStart() { const trace = []; const g = guarded(trace); try { g.throw("early"); } catch (error) { trace.push("out " + error); } const r = g.next(); return [r.value, r.done, trace.join("|")].join(","); }
function bodyThrows() { const g = throwsAtSecond(); const a = g.next().value; let message = "none"; try { g.next(); } catch (error) { message = error.message; } const r = g.next(); return [a, message, r.done, r.value].join(","); }
function resultsAreDistinct() { const g = counts(3); const a = g.next(); const b = g.next(); a.value = "changed"; a.extra = 1; return [a === b, a.value, b.value, Object.keys(a).join("+"), Object.keys(b).join("+")].join(","); }
const kept = [];
function resultEscapes() { const g = counts(2); const r = g.next(); kept.push(r); return Object.getPrototypeOf(r) === Object.prototype && JSON.stringify(r); }
function reenters() {
  let g;
  function* self() { try { g.next(); } catch (error) { yield error.constructor.name; } yield "after"; }
  g = self();
  return [g.next().value, g.next().value, g.next().done].join(",");
}
function twoAtOnce() { const a = counts(3), b = counts(3); const out = []; for (;;) { const x = a.next(); if (x.done) break; out.push(x.value + "" + b.next().value); b.next(); } return out.join(","); }
function handedOn(n) { const g = counts(n); g.next(); return drain(g); }
function drain(iterator) { let s = 0; for (const v of iterator) s += v; return s; }
function otherReceiver() { const g = counts(1); try { return g.next.call({}); } catch (error) { return error.constructor.name; } }
function replacedOnInstance() { const g = counts(2); g.next = () => ({ done: true, value: "own" }); let s = "loop"; for (const v of g) s += v; return s + ":" + g.next().value; }

for (let round = 0; round < 300; round++) {
  const all = [sumByHand(5), stepThenLoop(5), loopThenStep(6), afterTheEnd(), sendsValues(), observableArgument(), returnsEarly(), throwsIn(), throwsBeforeStart(), bodyThrows(),
    resultsAreDistinct(), resultEscapes(), reenters(), twoAtOnce(), handedOn(5), otherReceiver(), replacedOnInstance()];
  if (round === 0 || round === 299) all.forEach((text, index) => log(round, index, text));
}
log(kept.length, kept[0].value, kept[299].done);
console.log(lines.join("\n"));
