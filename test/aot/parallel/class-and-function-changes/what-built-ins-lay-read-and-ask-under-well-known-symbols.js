// Under: --aot-testing=CheckProofsAtRunTime: what is proven of objects that stay in sight behind a definition under a symbol is asked again at run time
// Object.defineProperty, Reflect and Object.hasOwn with a well-known symbol written as the key: what is laid is what the language's own protocols find: iteration, conversion, instanceof, tags, spreading, species, matching.
"use strict";
function tryTo(deed) {
  try { return deed(); } catch (error) { return error.name; }
}
const bag = { items: [1, 2, 3] };
Object.defineProperty(bag, Symbol.iterator, { value: function () { return this.items[Symbol.iterator](); } });
let sum = 0;
for (const n of bag) sum += n;
console.log(sum, [...bag].join(), Math.max(...bag), Object.keys(bag).join(), Array.from(bag).length);

const amount = { cents: 250 };
Object.defineProperty(amount, Symbol.toPrimitive, { value(hint) { return hint === "string" ? "2.50" : this.cents; } });
console.log(amount + 1, `${amount}`, amount * 2, amount > 200, [amount].join());

function Holder() { this.state = { mark: 1 }; }
Object.defineProperty(Holder, Symbol.hasInstance, { value: function (object) { return !!(object && object.state && object.state.mark); } });
console.log(new Holder() instanceof Holder, {} instanceof Holder, { state: { mark: 2 } } instanceof Holder);
class Even { static [Symbol.hasInstance](n) { return n % 2 === 0; } }
console.log(2 instanceof Even, 3 instanceof Even);
Object.defineProperty(Even, Symbol.hasInstance, { value: n => n % 2 === 1 });
console.log(2 instanceof Even, 3 instanceof Even);

const tagged = { id: 1 };
Object.defineProperty(tagged, Symbol.toStringTag, { value: "Tagged", configurable: true });
console.log(Object.prototype.toString.call(tagged), String(tagged));
Object.defineProperty(tagged, Symbol.toStringTag, { get() { return "By" + this.id; }, configurable: true });
console.log(Object.prototype.toString.call(tagged), tryTo(() => Object.defineProperty(Object.freeze({}), Symbol.toStringTag, { value: "late" })));
const listLike = { length: 2, 0: "a", 1: "b" };
console.log([0].concat(listLike).length);
Object.defineProperty(listLike, Symbol.isConcatSpreadable, { value: true });
console.log([0].concat(listLike).join());
const plainList = [1, 2];
Object.defineProperty(plainList, Symbol.isConcatSpreadable, { value: false });
console.log([0].concat(plainList).length);

class Special extends Array {}
Object.defineProperty(Special, Symbol.species, { value: Array });
const mapped = Special.from([1, 2]).map(n => n * 2);
console.log(mapped instanceof Special, mapped.join());

const matcher = { word: "b" };
Object.defineProperty(matcher, Symbol.match, { value(text) { return text.includes(this.word) ? ["found " + this.word] : null; } });
Object.defineProperty(matcher, Symbol.replace, { value(text, by) { return text.split(this.word).join(by); } });
Object.defineProperty(matcher, Symbol.search, { value(text) { return text.indexOf(this.word); } });
Object.defineProperty(matcher, Symbol.split, { value(text) { return text.split(this.word); } });
console.log("abc".match(matcher)[0], "abcb".replace(matcher, "-"), "abc".search(matcher), "abc".split(matcher).join("|"));

const stream = { left: 2 };
Object.defineProperty(stream, Symbol.asyncIterator, { value() { return { next: async () => (this.left-- > 0 ? { value: this.left, done: false } : { value: undefined, done: true }) }; } });

const asked = { id: 1 };
console.log(Object.hasOwn(asked, Symbol.iterator), Reflect.has(asked, Symbol.iterator), Reflect.get(asked, Symbol.iterator));
console.log(Reflect.set(asked, Symbol.iterator, function* () { yield this.id; }), [...asked].join(), Object.hasOwn(asked, Symbol.iterator));
console.log(typeof Object.getOwnPropertyDescriptor(asked, Symbol.iterator).value, Reflect.deleteProperty(asked, Symbol.iterator), tryTo(() => [...asked]));
console.log(Reflect.defineProperty(asked, Symbol.toPrimitive, { value: () => 7 }), +asked, tryTo(() => { asked[Symbol.toPrimitive] = () => 8; }), +asked);
function Proto() {}
Object.defineProperty(Proto.prototype, Symbol.iterator, { value: function* () { yield "from the prototype"; } });
console.log([...new Proto()].join());
(async () => {
  const seen = [];
  for await (const n of stream) seen.push(n);
  console.log(seen.join());
})();
