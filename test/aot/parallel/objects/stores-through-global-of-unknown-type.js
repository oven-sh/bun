// objects/stores-through-global-this where the compiler knows nothing of the object that is stored to: what native code hands back is unknown to it.
const holders = [globalThis, { count: -1, fixed: -1, watched: -1 }];
const unknown = value => new CustomEvent("unknown", { detail: value }).detail;
const pick = index => unknown(holders[index % holders.length]);
const log = [];
function attempt(label, f) {
  try {
    log.push(label + " " + f());
  } catch (error) {
    log.push(label + " " + error.constructor.name);
  }
}
function store(holder, value) {
  holder.count = value;
}
function storeFixed(holder, value) {
  holder.fixed = value;
}
function storeWatched(holder, value) {
  holder.watched = value;
}
function storeLate(holder, value) {
  holder.late = value;
}
function bump(holder) {
  holder.count++;
  holder.count += 2;
  return holder.count;
}

globalThis.count = 0;
let sum = 0;
for (let i = 0; i < 300; i++) {
  store(pick(0), i);
  sum += count + globalThis.count;
  store(pick(1), -i);
  sum += count;
}
attempt("replaced in a loop", () => [sum, count, holders[1].count]);
attempt("bumped", () => [bump(pick(0)), bump(pick(0)), count, bump(pick(1))]);
attempt("other kinds", () => { const seen = []; for (const value of [0.5, "text", null, undefined, { a: 1 }, 7]) { store(pick(0), value); seen.push(typeof count); } return seen; });

Object.defineProperty(globalThis, "fixed", { value: 1, writable: false, configurable: true });
attempt("read-only", () => { for (let i = 0; i < 3; i++) storeFixed(pick(1), i); storeFixed(pick(0), 2); return "stored"; });
attempt("read-only stays", () => [fixed, holders[1].fixed]);
Object.defineProperty(globalThis, "fixed", { value: 1, writable: true, configurable: true });
attempt("writable again", () => { storeFixed(pick(0), 3); return fixed; });

let seenBySetter = 0;
Object.defineProperty(globalThis, "watched", { get: () => seenBySetter, set: value => { seenBySetter += value; }, configurable: true });
attempt("setter", () => { for (let i = 0; i < 5; i++) storeWatched(pick(0), i); return [seenBySetter, watched]; });
Object.defineProperty(globalThis, "watched", { value: 9, writable: true, configurable: true });
attempt("a value in place of the setter", () => { storeWatched(pick(0), 10); return [seenBySetter, watched]; });

attempt("added", () => { const before = typeof late; storeLate(pick(0), 1); return [before, late, "late" in globalThis]; });
attempt("removed and added again", () => { const removed = delete globalThis.late; const between = typeof late; storeLate(pick(0), 2); storeLate(pick(0), 3); return [removed, between, late]; });
attempt("removed, then read by its name", () => { delete globalThis.late; return late; });
console.log(log.join("\n"));
