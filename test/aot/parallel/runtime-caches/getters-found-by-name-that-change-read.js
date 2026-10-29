// Getters that change the object while they run: one that replaces itself by its value, one that deletes itself, one that changes the Structure of the receiver, one that reads the
// same name on another object, one that reads it on the same object until a depth. Each has a place of its own that reads it. And one place that meets many Structures.
function lazy(name, compute) {
  return function () {
    const value = compute();
    Object.defineProperty(this, name, { value, writable: false, configurable: true });
    return value;
  };
}
function readLazy(object) { return object.held; }
const log = [];
let computed = 0;
const lazies = [];
for (let i = 0; i < 30; i++) {
  const made = Object.create(null);
  Object.defineProperty(made, "held", { get: lazy("held", () => ++computed), configurable: true });
  lazies.push(made);
}
log.push(lazies.map(readLazy).join(), lazies.map(readLazy).join(), String(computed));
function readVanishing(object) { return object.once; }
const vanishing = Object.create(null);
Object.defineProperty(vanishing, "once", { get() { delete this.once; return "once"; }, configurable: true });
log.push(readVanishing(vanishing), String(readVanishing(vanishing)));
function readGrowing(object) { return object.size; }
const growing = Object.create(null);
let grown = 0;
Object.defineProperty(growing, "size", { get() { this["added" + grown++] = grown; return Object.keys(this).length; }, configurable: true });
for (let i = 0; i < 70; i++) readGrowing(growing);
log.push(String(readGrowing(growing)));
function readLinked(object) { return object.linked; }
const first = Object.create(null), second = Object.create(null);
Object.defineProperty(first, "linked", { get() { return "first>" + readLinked(second); } });
Object.defineProperty(second, "linked", { get() { return "second"; } });
log.push(readLinked(first));
function readDeep(object) { return object.deep; }
let depth = 0;
const deep = Object.create(null);
Object.defineProperty(deep, "deep", { get() { return ++depth < 20 ? readDeep(this) + 1 : 0; } });
log.push(String(readDeep(deep)));
function readEndless(object) { return object.endless; }
const endless = Object.create(null);
Object.defineProperty(endless, "endless", { get() { return readEndless(this); } });
try { readEndless(endless); } catch (error) { log.push(error.constructor.name); }
function readMany(object) { return object.many; }
const many = [];
for (let i = 0; i < 40; i++) {
  const made = {};
  for (let j = 0; j < i % 8; j++) made["p" + j] = j;
  if (i % 3) Object.defineProperty(made, "many", { get: lazy("other", () => i), configurable: true }); else made.many = "value " + i;
  many.push(made);
}
log.push(many.map(readMany).join(), many.map(readMany).join());
console.log(log.join("\n"));
