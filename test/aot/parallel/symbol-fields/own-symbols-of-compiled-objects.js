// lodash's isEqual and cloneDeep ask every object for its own symbols. Fields have none, extra properties may.
const a = Symbol("a");
const b = Symbol.for("b");
const show = object => Object.getOwnPropertySymbols(object).map(String).join() + "|" + Reflect.ownKeys(object).map(String).join();
class Plain {
  first = 1;
  second = "two";
}
class WithSymbol {
  [a] = 1;
  name = "named";
}
class Below extends WithSymbol {
  [b] = 2;
}
const computed = { x: 1, [a]: 2, [b]: 3 };
const later = { x: 1 };
console.log(show(new Plain()), show(new WithSymbol()), show(new Below()), show(computed), show({}), show({ x: 1, y: { z: 2 } }));
console.log(show(later));
later[a] = 1;
console.log(show(later));
later.z = 5;
later[b] = 2;
console.log(show(later));
delete later[a];
console.log(show(later));
later[a] = 3;
console.log(show(later), show({ ...later }), show(Object.assign({}, later)), show(Object.assign(new Plain(), later)));
const numbered = { 1: "one", x: 1 };
numbered[7] = "seven";
numbered[a] = "a";
console.log(show(numbered));
const hidden = { x: 1 };
Object.defineProperty(hidden, b, { value: 1, enumerable: false });
Object.defineProperty(hidden, a, { get: () => 1, configurable: true });
console.log(show(hidden), Object.getOwnPropertySymbols(hidden).filter(symbol => Object.prototype.propertyIsEnumerable.call(hidden, symbol)).length);
for (const close of [Object.freeze, Object.seal, Object.preventExtensions]) console.log(show(close({ x: 1 })), show(close({ x: 1, [a]: 1 })), show(close(Object.assign(new Plain(), { [b]: 1 }))));
console.log(show(Object.create({ [a]: 1 })), show(Object.create(null, { [b]: { value: 1 } })), show(Object.setPrototypeOf({ x: 1 }, { [a]: 1 })), show(JSON.parse('{"x":1}')), show(Object.fromEntries([["x", 1], [a, 2]])));
console.log(show([1]), show(() => 1), show(class { static [a] = 1; }), show(new Map()), show(/x/), show(new Proxy({ [a]: 1 }, {})), show(Object("text")), show(Symbol.prototype).split("|")[0]);
class Private {
  #hidden = 1;
  get value() {
    return this.#hidden;
  }
}
console.log(show(new Private()), new Private().value);
// The list is the caller's own.
const list = Object.getOwnPropertySymbols(new Plain());
list.push(1);
console.log(list.length, Object.getOwnPropertySymbols(new Plain()).length, Object.getOwnPropertySymbols(computed) === Object.getOwnPropertySymbols(computed));
const changed = Object.getOwnPropertySymbols(later);
changed.length = 0;
changed[3] = b;
console.log(show(later), changed.length);
let total = 0;
for (let k = 0; k < 2000; k++) {
  const object = k % 3 ? { k, text: "t" + k } : Object.assign({ k }, { [a]: k });
  total += Object.getOwnPropertySymbols(object).length + Object.getOwnPropertySymbols(new Plain()).length;
}
console.log(total);
