// lodash reads Array and Object off a context that nobody knows, and calls them.
// COUNT: operation:operationAOTArrayPutAtIndexInSloppyCode <= 20
const context = globalThis[["global", "This"].join("")];
const of = name => context[name.toLowerCase().replace(/^./, first => first.toUpperCase())];
const List = of("array");
const Plain = of("object");

function rest(start, args) {
  const length = Math.max(args.length - start, 0);
  const array = List(length);
  for (let index = 0; index < length; index++) array[index] = args[start + index];
  return array;
}
let total = 0;
for (let k = 0; k < 3000; k++) {
  const found = rest(1, [k, "a", { k }, k + 0.5]);
  total += found.length + found[1].k + found[2];
}
console.log(total, rest(0, []).length, rest(4, [1]).length);

for (const length of [0, 1, 2, 5, 17, 126, 127, 128, 129, 1000, 100000]) {
  const array = List(length);
  console.log(length, array.length, 0 in array, Array.isArray(array), array.constructor === Array, Object.keys(array).length, JSON.stringify(array).length);
}
for (const given of [-1, 1.5, NaN, 2 ** 32, 2 ** 32 - 1, -0, "3", null, undefined, true, {}, [4], 3n, 2 ** 31]) {
  try {
    const array = List(given);
    console.log(typeof given, array.length, array.length === 1 ? typeof array[0] : 0 in array);
  } catch (error) {
    console.log(typeof given, error.name, error.message);
  }
}
console.log(List(3, 4).join(), List().length, new List(3).length, List(...[2]).length, List.call(null, 2).length, Reflect.apply(List, null, [2]).length);

// What is stored first decides nothing.
for (const value of [1, 0.5, "text", null, undefined, {}, NaN, -0, () => 1, 2n]) {
  const array = List(3);
  array[1] = value;
  console.log(0 in array, Object.is(array[1], value), array.indexOf(value), array.length, array.filter(() => true).length);
}
const numbers = List(4);
for (let k = 0; k < 4; k++) numbers[k] = k / 2;
numbers.sort((first, second) => second - first);
console.log(numbers.join(), numbers.map(value => value * 2).join(), List(4).fill(7).join(), [...List(2)].length, List(2).concat([1]).length);

const object = { a: 1 };
const proxy = new Proxy(object, {});
const symbol = Symbol("s");
const call = value => Plain(value);
for (const value of [object, [1], () => 1, proxy, new Map(), new Date(0), /x/, Object.create(null), new String("s"), globalThis, List, Plain]) console.log(call(value) === value);
for (const value of [1, -0, "text", true, symbol, 5n]) console.log(typeof call(value), Object.prototype.toString.call(call(value)), call(value) == value, call(value).valueOf() === value);
for (const value of [null, undefined]) console.log(Object.getPrototypeOf(call(value)) === Object.prototype, Object.keys(call(value)).length);
console.log(Plain(object, 2) === object, Plain() instanceof Object, "a" in Plain(object), Object.getPrototypeOf(Plain("x")) === String.prototype);

// A realm of its own has an Array of its own.
const realm = require("node:vm").createContext({});
const [OtherList, OtherPlain] = require("node:vm").runInContext("[Array, Object]", realm);
for (const Constructor of [List, OtherList]) {
  const array = Constructor(2);
  console.log(array instanceof Array, array instanceof Constructor, Array.isArray(array), Object.getPrototypeOf(array) === Constructor.prototype, array.length);
}
for (const Constructor of [Plain, OtherPlain]) console.log(Constructor(object) === object, Constructor(1) instanceof Number, Object.getPrototypeOf(Constructor(null)) === Constructor.prototype);

class Below extends List {}
console.log(new Below(3).length, new Below(3) instanceof Below);
