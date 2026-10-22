// One object for each binding, whoever reads it first and however often.
const shared = { n: 0 };
const holderA = { s: shared };
const holderB = { s: shared };
const list = [shared, shared];
const fn = () => shared;
const nested = { deep: { deeper: { s: shared } } };
class Counter { static made = 0; id = ++Counter.made; }
const one = new Counter();
const two = new Counter();
const sym = Symbol("s");
const keyed = { [sym]: 1 };
const registered = Symbol.for("lazy.attack");
function readTwice<T>(read: () => T) { return read() === read(); }
function main(order: string) {
  if (order === "b") console.log(holderB.s === shared, holderA.s === holderB.s);
  else console.log(holderA.s === holderB.s, holderB.s === shared);
  holderA.s.n++;
  console.log(shared.n, list[0] === list[1], list[1] === fn(), nested.deep.deeper.s.n);
  console.log(readTwice(() => holderA), readTwice(() => list), readTwice(() => nested.deep), readTwice(() => sym), readTwice(() => one));
  console.log(order === "b" ? [two.id, one.id] : [one.id, two.id], Counter.made);
  console.log(keyed[sym], registered === Symbol.for("lazy.attack"), sym.description);
}
main(process.argv[2] ?? "a");
