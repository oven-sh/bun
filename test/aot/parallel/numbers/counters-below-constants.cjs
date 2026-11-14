// Behind a relation with a written integer an integer lies on its side of it: what is passed, stored, captured and returned there is a 32-bit integer.
// Every other value passes as it is: fractions, NaN, strings, objects, and integers past 32 bits where the relation does not bound them.
const out = [];
const say = value => void out.push(typeof value + " " + (Object.is(value, -0) ? "-0" : String(value)));
class Entry {
  constructor(key, value) {
    this.key = key;
    this.value = value;
    this.next = null;
  }
}
let kept = 0;
const list = [];
function put(key) {
  const entry = new Entry(key, key * 2);
  kept = entry.key;
  list.push(entry.value);
  return entry.key + entry.value;
}
for (let i = 0; i < 100; i++) say(put(i));
for (let i = 2147483640; i <= 2147483647; i++) say(put(i));
for (let i = 2147483645; i < 2147483650; i++) say(put(i));
for (let i = -3; i < 3; i++) say(put(i));
for (let i = 0.5; i < 3; i++) say(put(i));
let down = 5;
while (--down >= 0) say(put(down));
say(put(down));
for (let i = 3; i >= -2; i -= 1) say(put(i));
function fib(n) {
  return n < 2 ? n : fib(n - 1) + fib(n - 2);
}
say(fib(15));
function below(n) {
  if (n < 10) return () => n;
  if (1000 <= n) return () => n + 1;
  if (!(n > 20)) kept = n;
  else say(n - 1);
  return () => kept;
}
for (const n of [0, 9, 10, 15, 20, 21, 999, 1000, -1, -0, 4294967295, 9007199254740991, 9007199254740992, 9.5, NaN, -Infinity, "3", "30", null, undefined, true, 7n, { valueOf: () => 4 }])
  say(below(n)());
function* steps(n) {
  while (n < 4) yield n++;
  say(n);
}
for (const n of [0, 2.5, "1"]) for (const step of steps(n)) say(put(step));
say(kept);
console.log(out.join("\n"));
console.log(list.join());
