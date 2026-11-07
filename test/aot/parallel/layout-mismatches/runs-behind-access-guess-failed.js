// A function that nobody has checked asks an object for names that one class has. What arrives is sometimes an instance of the class and sometimes anything else that answers to the names,
// or to some of them. Whatever arrives, each access happens once, in the order written, and what stands behind the accesses sees the values that they gave.
const lines = [];
let log = [];
function show(label, value) {
  lines.push(label + ": " + JSON.stringify(value) + (log.length ? " | " + log.join(",") : ""));
  log = [];
}

class Hook {
  constructor(state, queue, next) { this.memoizedState = state; this.baseQueue = queue; this.nextHook = next; }
}
class Watched {
  get memoizedState() { log.push("state"); return 70; }
  get baseQueue() { log.push("queue"); return 80; }
  get nextHook() { log.push("next"); return null; }
}
class Below extends Hook {
  constructor(state, queue, next) { super(state, queue, next); this.more = "more"; }
}

function twoReads(hook, combine) {
  const state = hook.memoizedState;
  const queue = hook.baseQueue;
  return combine(state, queue) + (hook.memoizedState === state ? ":same" : ":changed");
}
function readsAndStores(hook, value) {
  const before = hook.memoizedState;
  hook.memoizedState = value;
  hook.baseQueue = before;
  return [before, hook.memoizedState, hook.baseQueue];
}
function walk(hook) {
  let total = 0, steps = 0;
  while (hook) {
    total += hook.memoizedState;
    hook = hook.nextHook;
    steps++;
  }
  return [total, steps];
}
function twoObjects(a, b) {
  const x = a.memoizedState, y = b.memoizedState;
  a.baseQueue = y;
  b.baseQueue = x;
  return [x, y, a.baseQueue, b.baseQueue];
}
function changesOnTheWay(hook, change) {
  const first = hook.memoizedState;
  change(hook);
  const second = hook.memoizedState;
  const third = hook.baseQueue;
  return [first, second, third];
}
const join = (a, b) => String(a) + "/" + String(b);

const proxy = new Proxy(new Hook(1, 2, null), { get(target, key, receiver) { log.push("trap " + String(key)); return Reflect.get(target, key, receiver); }, set(target, key, value) { log.push("set " + String(key)); target[key] = value; return true; } });
const bare = Object.assign(Object.create(null), { memoizedState: "bare", baseQueue: "queue" });
const inherits = Object.create(new Hook("above", "aboveQueue", null));
const frozen = Object.freeze(new Hook("frozen", "q", null));
const lost = new Hook("lost", "q", null); delete lost.memoizedState;
const redefined = new Hook("slot", "q", null); Object.defineProperty(redefined, "memoizedState", { get() { log.push("own getter"); return "got"; }, set(v) { log.push("own setter " + v); }, configurable: true });
const makers = {
  hook: () => new Hook(1, 2, null), below: () => new Below(3, 4, null), record: () => ({ memoizedState: 5, baseQueue: 6, nextHook: null }), otherOrder: () => ({ nextHook: null, baseQueue: 8, memoizedState: 7 }),
  some: () => ({ memoizedState: 9 }), none: () => ({}), watched: () => new Watched(), proxy: () => proxy, bare: () => bare, inherits: () => inherits, frozen: () => frozen, lost: () => lost, redefined: () => redefined,
  array: () => [1, 2], func: () => function named() {}, text: () => "text", number: () => 12, symbol: () => Symbol.iterator, big: () => 10n, yes: () => true,
};
for (let round = 0; round < 3; round++) {
  for (const [name, make] of Object.entries(makers)) {
    show(round + " twoReads " + name, twoReads(make(), join));
    let stored;
    try { stored = readsAndStores(make(), "v" + round); } catch (error) { stored = error.constructor.name; }
    show(round + " readsAndStores " + name, stored);
  }
}
for (const nothing of [null, undefined]) {
  for (const f of [twoReads, readsAndStores, h => twoObjects(new Hook(1, 2, null), h), h => twoObjects(h, new Watched())]) {
    try { show("nothing", f(nothing, join)); } catch (error) { show("nothing", error.constructor.name); }
  }
}

let chain = null;
for (let i = 0; i < 40; i++) {
  if (i % 7 === 3) chain = { memoizedState: i, nextHook: chain };
  else if (i % 11 === 5) chain = Object.create(new Hook(i, 0, chain));
  else if (i % 13 === 6) { const rest = chain; chain = { get memoizedState() { log.push("g" + i); return i; }, get nextHook() { log.push("n" + i); return rest; } }; }
  else chain = i % 2 ? new Hook(i, 0, chain) : new Below(i, 0, chain);
}
for (let i = 0; i < 3; i++) show("walk", walk(chain));
let sum = 0;
for (let i = 0; i < 20000; i++) sum += walk(i % 50 ? new Hook(i, 0, new Hook(1, 0, null)) : { memoizedState: i, nextHook: { memoizedState: 2 } })[0];
show("sum", sum);

const pairs = [[new Hook(1, 2, null), new Hook(3, 4, null)], [new Hook(1, 2, null), { memoizedState: "r" }], [{ memoizedState: "l" }, new Hook(3, 4, null)], [new Watched(), new Hook(5, 6, null)], [proxy, proxy]];
for (const [a, b] of pairs) {
  try { show("twoObjects", twoObjects(a, b)); } catch (error) { show("twoObjects", error.constructor.name); }
}
const one = new Hook("one", "q", null);
show("twoObjects the same", twoObjects(one, one));

const changes = {
  nothing() {}, store(h) { h.memoizedState = "stored"; }, remove(h) { delete h.memoizedState; }, removeBoth(h) { delete h.memoizedState; delete h.baseQueue; },
  getter(h) { Object.defineProperty(h, "memoizedState", { get() { log.push("late getter"); return "late"; }, configurable: true }); },
  prototype(h) { delete h.baseQueue; Object.setPrototypeOf(h, { baseQueue: "from the new prototype" }); }, add(h) { h.added = 1; }, freeze(h) { Object.freeze(h); },
};
for (let round = 0; round < 2; round++) {
  for (const [name, change] of Object.entries(changes)) {
    show("changesOnTheWay hook " + name, changesOnTheWay(new Hook("first", "queue", null), change));
    show("changesOnTheWay record " + name, changesOnTheWay({ memoizedState: "first", baseQueue: "queue" }, change));
  }
}
console.log(lines.join("\n"));
