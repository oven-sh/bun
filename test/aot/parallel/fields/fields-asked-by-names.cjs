// What a field of the one state holds is expected by the names that are asked of it: objects of two classes with those names, then everything else that can stand there.
"use strict";
class Reaction { constructor(id) { this.runId = id; this.count = 0; this.observing = []; this.isDone = false; this.name = "r" + id; } visit(o) { return "R" + this.runId + o.lastBy; } }
class Computed { constructor(id) { this.lastBy = -1; this.runId = id; this.count = 0; this.observing = []; this.isDone = false; this.value = id * 0.5; } visit(o) { return "C" + this.runId + o.lastBy; } }
class Value { constructor(v) { this.lastBy = 0; this.isSeen = false; this.observers = new Set(); this.held = v; } onSeen() { log.push("seen " + this.held); } }
class Other { constructor() { this.observing = "text"; this.count = "x"; this.runId = undefined; } }
class State { constructor() { this.tracking = null; this.inBatch = 0; this.context = null; this.pending = []; } }
let state = new State();
const log = [];
function report(o) {
  const by = state.tracking;
  if (by !== null) {
    if (by.runId !== o.lastBy) { o.lastBy = by.runId; by.observing[by.count++] = o; if (!o.isSeen && state.context) { o.isSeen = true; o.onSeen(); } }
    return true;
  }
  if (o.observers.size === 0 && state.inBatch > 0) state.pending.push(o);
  return false;
}
function tell(o) { try { const by = state.tracking; return [by.runId, by.count, by.observing.length, by.isDone, typeof by.visit, by.visit ? by.visit(o) : "none"].join(); } catch (e) { return e.constructor.name; } }
const values = [1, 2, 3, 4].map(v => new Value(v));
const holders = [
  () => new Reaction(1), () => new Computed(2), () => null, () => ({ runId: 3, count: 0, observing: [], isDone: 0, visit() { return "plain"; } }), () => Object.create(new Reaction(4)), () => new Other(),
  () => new Proxy(new Reaction(5), { get(t, k, w) { log.push("get " + String(k)); return Reflect.get(t, k, w); }, set(t, k, v, w) { log.push("set " + String(k)); return Reflect.set(t, k, v, w); } }),
  () => Object.defineProperty(new Computed(6), "runId", { get() { log.push("asked"); return 6; } }), () => { const r = new Reaction(7); delete r.count; return r; }, () => { const r = new Computed(8); r.extra = 1; delete r.lastBy; return r; }, () => Object.freeze(new Reaction(9)),
  () => undefined, () => "text", () => 5, () => Symbol.iterator, () => [], () => class { static observing = []; static count = 0; static runId = 10; static visit() { return "static"; } }, () => Object.setPrototypeOf(new Reaction(11), null), () => new (class extends Computed { visit() { return "below"; } get isDone() { return "getter"; } set isDone(v) {} })(12),
];
for (let round = 0; round < 3; round++) for (const make of holders) {
  state.tracking = make(); state.context = round === 1 ? {} : null; state.inBatch = round;
  for (let i = 0; i < 6; i++) { const o = values[i % 4]; if (i === 5) o.lastBy = "other"; let a; try { a = report(o); } catch (e) { a = e.constructor.name; } log.push(a + " " + tell(o) + " " + String(o.lastBy) + o.isSeen + state.pending.length); }
  if (round === 2) { state = Object.assign(new State(), { pending: state.pending.slice(0, 2) }); if (log.length % 3 === 0) Object.defineProperty(state, "tracking", { get() { return new Reaction(99); }, set(v) {}, configurable: true }); }
}
let sum = 0; state = new State(); state.tracking = new Reaction(20); for (let i = 0; i < 40; i++) { if (i === 20) state.tracking = new Computed(21); if (i === 30) state.tracking = { runId: "r", count: 0, observing: {}, visit: () => 1 }; sum += report(values[i % 4]) ? 1 : 0; sum += state.tracking.count; }
log.push(sum, Object.keys(state.tracking.observing).join());
console.log(log.join("\n"));
