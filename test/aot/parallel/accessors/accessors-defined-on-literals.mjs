// Object.defineProperty lays an accessor on the object of a literal, in front of everything that sees the object or behind it.
const log = [], kept = [];
function attempt(f) {
  try {
    return String(f());
  } catch (error) {
    return error.constructor.name;
  }
}
function describe(object, name) {
  const found = Object.getOwnPropertyDescriptor(object, name);
  return found ? [typeof found.get, typeof found.set, found.enumerable, found.configurable, "writable" in found].join() : "none";
}
function rounds(object) {
  let sum = 0;
  for (let i = 0; i < 40; i++) {
    sum += object.size;
    object.size = i & 3;
  }
  return sum + "/" + object.v;
}

function early() { return attempt(() => hoisted.size); }
log.push(early());
const hoisted = { v: 1 };
Object.defineProperty(hoisted, "size", { get() { return this.v; }, set(x) { this.v = x * 2; } });
log.push(early(), rounds(hoisted), describe(hoisted, "size"), Object.keys(hoisted).join());

export const shared = { v: 2 };
Object.defineProperty(shared, "size", { get() { return this.v; }, set(x) { this.v = x + 1; }, enumerable: true });
Object.defineProperty(shared, "tail", { get() { return "t" + this.size; }, configurable: true });
log.push(rounds(shared), shared.tail, describe(shared, "size"), describe(shared, "tail"), JSON.stringify(shared), delete shared.tail, shared.tail);

function make(v) {
  const made = { v };
  Object.defineProperty(made, "size", { get() { return this.v; }, set(x) { this.v = x; }, enumerable: true, configurable: true });
  return made;
}
const first = make(1), second = make(2);
log.push(rounds(first), rounds(second), [first, second].map(o => o.size).join());
Object.defineProperty(second, "size", { get() { return "again"; } });
log.push(first.size, second.size, attempt(() => { "use strict"; second.size = 5; }), second.v, describe(second, "size"));

function seen(v) {
  const made = { v };
  kept.push(() => made.size);
  log.push(attempt(() => kept[kept.length - 1]()));
  Object.defineProperty(made, "size", { get: () => made.v + 1, set: x => { made.v = x; } });
  return made;
}
log.push(rounds(seen(3)), kept[0](), attempt(() => delete seen(4).size));

function chosen(v, isLaid) {
  const made = { v };
  if (isLaid)
    Object.defineProperty(made, "size", { get() { return this.v; }, set(x) { this.v = x; } });
  return made;
}
log.push(rounds(chosen(5, true)), rounds(chosen(6, false)), describe(chosen(7, false), "size"));

function guarded(v) {
  const made = { v };
  try {
    Object.defineProperty(made, "size", { get() { if (this.v === 2) throw new RangeError("two"); return this.v; }, set(x) { if (x === 3) throw new TypeError("three"); this.v = x; } });
    Object.defineProperty(made, "size", { get() { return "never"; } });
  } catch (error) {
    log.push(error.constructor.name);
  }
  return made;
}
log.push(attempt(() => rounds(guarded(1))), attempt(() => { const g = guarded(2); return g.size; }));

function half(which) {
  const made = { v: 8 };
  if (which) Object.defineProperty(made, "size", { get() { return this.v; } });
  else Object.defineProperty(made, "size", { set(x) { this.v = x; } });
  return made;
}
for (const which of [0, 1]) {
  const made = half(which);
  log.push(made.size, attempt(() => { made.size = 9; }), made.v, made.size, describe(made, "size"));
}

const stored = { v: 10 };
stored.size = 3;
Object.defineProperty(stored, "size", { get() { return this.v; }, set(x) { this.v = x; } });
log.push(rounds(stored), describe(stored, "size"));

const heir = Object.create(shared);
heir.size = 6;
log.push(heir.v, shared.v, Object.keys(heir).join(), { ...shared }.size, Object.assign({}, shared).size, Object.isFrozen(Object.freeze(hoisted)), attempt(() => { hoisted.size = 1; }), hoisted.size);

const self = { v: 1 };
Object.defineProperty(self, "size", { get() { return this; }, set(x) { this.v = x === this ? "self" : "other"; } });
self.size = self;
log.push(self.size === self, self.v, self.size.size.v);
console.log(log.join("\n"));
