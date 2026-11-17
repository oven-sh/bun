// Under: --aot-testing=CheckProofsAtRunTime: what is proven of a field that a descriptor fills is asked again at run time
// The value of a descriptor that is written at the call lies under the name from then on, writable or not: what is stored on it, read off it and called through it, and what a later store, definition or deletion makes of it.
function make(kind) {
  const made = {};
  Object.defineProperty(made, "inner", { value: { kind, seen: 0 }, enumerable: false });
  made.inner.run = (payload, context) => {
    if (context.skip) return payload;
    if (context.direction === "back") payload.value = -payload.value;
    made.inner.seen++;
    payload.issues.push(kind);
    return payload;
  };
  return made;
}
function parse(made, value, skip, direction) {
  return made.inner.run({ value, issues: [] }, { skip, direction });
}
const first = make("first"), second = make("second");
let sum = 0;
for (let i = 0; i < 1000; i++) {
  const answer = parse(i & 1 ? first : second, i, i % 7 === 0, i % 3 ? "forth" : "back");
  sum += answer.value + answer.issues.length;
}
console.log(sum, first.inner.seen, second.inner.seen, Object.keys(first).length, JSON.stringify(first), "inner" in first);

function tryTo(deed) {
  try { return deed(); } catch (error) { return error.name; }
}
const held = first.inner;
console.log(tryTo(() => { "use strict"; first.inner = { kind: "other", seen: -1 }; return "stored"; }), first.inner === held, first.inner.kind);
console.log(tryTo(() => delete first.inner), first.inner === held);
console.log(tryTo(() => Object.defineProperty(first, "inner", { value: 5 })) === first, first.inner === held);

class Holder {
  constructor(count) {
    Object.defineProperty(this, "count", { value: count, writable: false, enumerable: true, configurable: true });
    Object.defineProperty(this, "list", { value: [count], writable: true, enumerable: false, configurable: false });
    Object.defineProperty(this, "text", { value: "t" + count });
  }
  total() { return this.count + this.list.length + this.text.length; }
}
const holder = new Holder(3);
console.log(holder.total(), Object.keys(holder).join(), JSON.stringify(holder));
holder.list = [1, 2, 3];
console.log(holder.total(), tryTo(() => { "use strict"; holder.count = 9; return "stored"; }), holder.count);
Object.defineProperty(holder, "count", { value: "nine" });
console.log(holder.count, holder.total(), typeof holder.count);
console.log(delete holder.count, holder.count, tryTo(() => holder.total()));

const mixed = [];
for (let i = 0; i < 4; i++) {
  const one = { id: i };
  Object.defineProperty(one, "mark", { value: i % 2 ? { odd: i } : i, enumerable: false });
  mixed.push(one);
}
console.log(mixed.map(one => typeof one.mark === "object" ? one.mark.odd : one.mark + 0.5).join());

const frozen = Object.freeze({ a: 1 });
console.log(tryTo(() => Object.defineProperty(frozen, "b", { value: { c: 1 } })), frozen.b);

function viaGetter(value) {
  const made = {};
  Object.defineProperty(made, "inner", { get() { return value; }, enumerable: false });
  return made.inner;
}
console.log(viaGetter({ k: 7 }).k);

const shared = { value: undefined, enumerable: false };
function viaShared(value) {
  const made = {};
  shared.value = value;
  Object.defineProperty(made, "inner", shared);
  shared.value = undefined;
  return made;
}
console.log(viaShared({ k: 8 }).inner.k, viaShared(9).inner);

function underKey(key, value) {
  const made = {};
  Object.defineProperty(made, key, { value, enumerable: false });
  return made;
}
console.log(underKey("inner", { k: 10 }).inner.k, underKey(process.argv.length > 99 ? "x" : "other", 11).other);
