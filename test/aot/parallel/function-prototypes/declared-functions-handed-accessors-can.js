// Functions that are declared and then handed over as the `get` or the `set` of a property descriptor store into the object they are called on. They can still be constructed, called, compared and read like any function.
function Holder(n) { this.n = n; this.cache = null; this.stored = 0; }
function readTwice() { if (this.cache === null) this.cache = this.n * 2; return this.cache; }
function storeTwice(v) { this.stored = v; this.cache = null; this.n = v / 2; }
Object.defineProperty(Holder.prototype, "twice", { get: readTwice, set: storeTwice, enumerable: true, configurable: true });
function both(v) { this.seen = v === undefined ? "read" : "stored"; return this.seen; }
Object.defineProperties(Holder.prototype, { either: { get: both, set: both } });
function Maker(n) { this.made = n; } // a constructor that is also somebody's getter
const odd = Object.defineProperty({}, "maker", { get: Maker });
let line = [];
for (let i = 0; i < 300; i++) { const h = new Holder(i); const a = h.twice; h.twice = a + 2; line = [a, h.twice, h.n, h.stored, h.cache, h.either, (h.either = 1), h.seen, Object.keys(h).join()]; }
console.log(line.join(" "));
const built = new readTwice(); console.log(Object.keys(built).join(), built.cache, built instanceof readTwice, Object.getPrototypeOf(built) === readTwice.prototype, built.constructor === readTwice);
const stored = new storeTwice(8); console.log(JSON.stringify(stored), stored instanceof storeTwice);
console.log(JSON.stringify(new Maker(3)), new Maker(4) instanceof Maker, odd.maker, JSON.stringify(odd), Object.keys(odd).join());
for (let i = 0; i < 100; i++) line = [new Maker(i).made, new readTwice().cache, JSON.stringify(new both(i))];
console.log(line.join(" "));
console.log(Object.getOwnPropertyDescriptor(Holder.prototype, "twice").get === readTwice, Holder.prototype.__lookupGetter__("twice") === readTwice, readTwice.name, readTwice.length, storeTwice.length, typeof readTwice.prototype);
console.log(readTwice.call({ cache: null, n: 21 }), readTwice.call({ cache: 5 }), Reflect.get(Holder.prototype, "twice", { cache: null, n: 4 }), Reflect.construct(readTwice, [], Holder) instanceof Holder);
class Below extends Holder { get twice() { return super.twice + 1; } } console.log(new Below(5).twice);
readTwice.prototype.extra = 1; console.log(new readTwice().extra);
