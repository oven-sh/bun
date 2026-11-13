// A field that holds an integer, null or undefined takes four bytes. Null and undefined are false there, and so is zero.
class State {
  constructor(x) {
    this.x = x;
    this.n = 0;
    this.list = [];
  }
  clone() {
    return new State(this.x);
  }
}
class Entry {
  constructor(hash, count, next, key) {
    this.hash = hash | 0;
    this.count = count;
    this.next = next;
    this.key = key;
  }
}
class Signed {
  constructor(low, high, name) {
    this.low = low;
    this.high = high;
    this.name = name;
    this.next = null;
  }
}
const show = value => (Object.is(value, -0) ? "-0" : typeof value === "object" && value ? "o" : String(value));
const states = [new State(null), new State(9), new State(0)];
const entries = [new Entry(1, null, null, "a"), new Entry(2, 3, null, "b"), new Entry(3, 0, null, "c"), new Entry(4, undefined, null, "d")];
const signed = [new Signed(-5, null, "a"), new Signed(null, 7, "b"), new Signed(0, undefined, "c"), new Signed(undefined, 0, "d"), new Signed(-2147483643, 2147483647, "e")];
function truths(value) {
  return [value ? 1 : 2, !value, value || "or", value && "and", !!value, typeof value === "object" && value ? value.n : value].map(show).join();
}
function ofState(i) {
  const a = states[i].x;
  return [a ? 1 : 2, !a, a || "or", a && "and", typeof a === "object" && a ? a.n : a, a ?? "none", a == null, a === null].map(show).join();
}
for (let round = 0; round < 3; round++) {
  for (let i = 0; i < states.length; i++) {
    const old = states[i];
    states[i] = old.clone();
    states[i].n += 2;
    console.log(ofState(i), truths(old.x), states[i].n, states[i].list.length);
  }
  for (const entry of entries) console.log(entry.hash, truths(entry.count), entry.count ? "yes" : "no", entry.count && entry.next ? 1 : 2, entry.key);
  for (const one of signed) {
    let steps = 0;
    while (one.low && steps < 3) steps++;
    console.log(truths(one.low), truths(one.high), one.low ? "yes" : "no", one.high ? "yes" : "no", one.low && one.high ? "both" : one.low || one.high ? "one" : "none", steps, one.name, one.next);
  }
}
console.log(states.filter(one => one.x).length, entries.filter(one => !one.count).length, signed.some(one => !one.low));
function make() {
  let state = new State(null);
  function go() {
    const a = state.x;
    state = state.clone();
    state.n += 2;
    return [typeof a === "object" && a ? a.n : a, state.n];
  }
  return [{ go }, () => [state.x, state.n, state.list?.length]];
}
const [doer, look] = make();
for (let i = 0; i < 4; i++) console.log(doer.go().map(show).join());
console.log(look().map(show).join());
