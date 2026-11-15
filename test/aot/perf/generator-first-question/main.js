// main.js <objects on the heap> <a way, or nothing>: a generator is made, and asked in that way or not at all.
function* count() {
  yield 1;
  yield 2;
}
const objects = Number(process.argv[2]);
class Other {}
const ways = {
  "instanceof": it => it instanceof Other,
  "getPrototypeOf": it => Object.getPrototypeOf(it) === count.prototype,
  "inspect": it => Bun.inspect(it),
  "not asked": it => it.next().value,
};
const kept = [];
for (let index = 0; index < objects; index++) kept.push({ index });
// Whoever makes a generator and takes its first step himself makes it with its prototype. These are handed on as they are made.
const first = [count(), count()];
const ask = ways[process.argv[3] ?? "not asked"];
console.log(kept.length, ask(count()), first.map(it => it.next().value).join());
