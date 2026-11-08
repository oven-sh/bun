// A set, a text, `arguments`, a generator, an object with an iterator of its own, and what cannot be iterated over.
class Taker { take(a, b, ...rest) { return a + b + ":" + rest.join(); } }
function spread(taker, what) { return taker.take(1, 2, ...what); }
function ofArguments(taker) { return taker.take(1, 2, ...arguments); }
function* numbers() { yield 7; yield 8; }
const taker = new Taker();
const own = [1, 2]; own[Symbol.iterator] = function* () { yield "own"; };
class Heir extends Array { *[Symbol.iterator]() { yield "heir"; } }
let last = "";
for (let i = 0; i < 300; i++) {
  let failed; try { spread(taker, i); } catch (error) { failed = error.name; }
  last = [spread(taker, new Set([i, "s"])), spread(taker, "ab"), ofArguments(taker, i), spread(taker, numbers()), spread(taker, own), spread(taker, Heir.from([1])), spread(taker, [i]), failed].join(" ");
}
console.log(last);
