// `keys.push.apply(keys, symbols)`, as the helpers that Babel emits for `{ ...a }` write it: an object has no symbols, so nothing is appended.
// The answer of Object.keys() shares its elements with every other answer for that shape, and goes on sharing them.
// The one call is the frozen list's.
// COUNT: operation:operationAOTAppendElements <= 1
function ownKeys(object) {
  const keys = Object.keys(object);
  keys.push.apply(
    keys,
    Object.getOwnPropertySymbols(object).filter(function (symbol) {
      return Object.getOwnPropertyDescriptor(object, symbol).enumerable;
    }),
  );
  return keys;
}
const mark = Symbol("mark");
const plain = { a: 1, b: 2 };
const marked = { a: 1, [mark]: 2 };
let length = 0;
for (let turn = 0; turn < 1000; turn++) length += ownKeys(plain).length;
console.log(length);
const frozen = Object.freeze(Object.keys(plain));
try {
  frozen.push.apply(frozen, []);
  console.log("a frozen list takes nothing", frozen.length);
} catch (error) {
  console.log(error.constructor.name);
}
const fixed = Object.keys(plain);
Object.defineProperty(fixed, "length", { writable: false });
try {
  fixed.push.apply(fixed, []);
  console.log("a list of fixed length takes nothing", fixed.length);
} catch (error) {
  console.log(error.constructor.name);
}
const grown = ownKeys(marked);
console.log(grown.length, typeof grown[1], Object.keys(marked).length);
const first = ownKeys(plain);
first.push("c");
console.log(first.join(), ownKeys(plain).join());
