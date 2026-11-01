const small = [1, 2, 3, 4, 5, 6, 7, 8];
const few = [9, 10, 11];
const large = [2147483647, 2147483648, 4294967296, 2 ** 40, -2147483649];
const fractions = [0.5, 1.5, -0, NaN, Infinity];
const texts = ["a", "b"];
const withHole = [1, , 3];
const pushed = [];
for (let k = 0; k < 8; k++) pushed.push(k);

function describe(list) {
  let sum = 0;
  let doubled = 0;
  let shifted = 0;
  let kinds = "";
  for (let k = 0; k < list.length; k++) {
    const element = list[k];
    if (typeof element === "number") {
      sum += element;
      doubled = (doubled + element * 2) % 1000003;
      shifted ^= element << 3;
      if (Object.is(element, -0)) kinds += "z";
    } else kinds += k in list ? (Array.isArray(element) ? "l" : (typeof element)[0]) : "h";
  }
  return list.length + " " + sum + " " + doubled + " " + shifted + " " + kinds;
}

function twoLists(a, b) {
  return a.concat(b);
}
function itself() {
  const b = small.concat(small);
  return (b[3] ?? 0) + (b[12] ?? 0) + (b[16] ?? -1);
}
function withLarge() {
  const b = small.concat(large);
  return b[9] + b[10] + 1;
}
function withNumber(n) {
  const b = small.concat(n);
  return b[8] * 2 + 1;
}
function withSeveral(n) {
  return small.concat(few, n, large, n + 0.5);
}
function listOrNumber(i) {
  const more = i % 3 === 0 ? 5000000000 + i : i % 3 === 1 ? few : [i * 1e10];
  const b = small.concat(more);
  return b[8] + b[0];
}
function parsed(text) {
  const b = small.concat(JSON.parse(text));
  return b[8] + b[b.length - 1];
}
function nested() {
  const b = small.concat([few], [[large]]);
  return b.length + " " + b[8].length + " " + b[9][0][3];
}
function storesWhatArrives(values) {
  const list = [1, 2, 3];
  for (let k = 0; k < values.length; k++) list.push(values[k]);
  list[1] = values[values.length - 1];
  list.unshift(values[0]);
  return list;
}
function fieldsIntoList(record) {
  const list = [1, 2];
  list.push(record.count);
  list[0] = record.total;
  return list[0] + list[2] + 1;
}

console.log("itself", itself());
console.log("with large", withLarge());
for (const n of [3, 2147483647, 2147483648, 5e9, 0.25, -0, NaN]) console.log("with a number", n, withNumber(n));
for (const n of [1, 3e9]) console.log("with several", describe(withSeveral(n)));
let mixed = 0;
for (let i = 0; i < 9; i++) mixed += listOrNumber(i);
console.log("a list or a number", mixed);
for (const text of ["[4294967296]", "7000000000", "[0.5, 1e300]", "[]", '["x"]', "[[1]]", "null"]) console.log("parsed", text, parsed(text));
console.log("nested", nested());

for (const [name, a, b] of [
  ["small small", small, small],
  ["small few", small, few],
  ["small large", small, large],
  ["large small", large, small],
  ["small fractions", small, fractions],
  ["fractions small", fractions, small],
  ["small texts", small, texts],
  ["small hole", small, withHole],
  ["hole small", withHole, small],
  ["pushed pushed", pushed, pushed],
  ["pushed large", pushed, large],
  ["small number", small, 6e9],
  ["small text", small, "t"],
  ["small undefined", small, undefined],
])
  console.log(name, describe(twoLists(a, b)));

console.log("stores", describe(storesWhatArrives(large)), "|", describe(storesWhatArrives(fractions)), "|", describe(storesWhatArrives(few)));
console.log("fields", fieldsIntoList({ count: 3e9, total: 2 ** 33 }), fieldsIntoList({ count: 1, total: 2 }), fieldsIntoList(JSON.parse('{"count":1e12,"total":0.5}')));

const spreadable = { length: 2, 0: 3e9, 1: 0.5, [Symbol.isConcatSpreadable]: true };
console.log("spreadable", describe(small.concat(spreadable)));
const kept = [1e10, 2e10];
kept[Symbol.isConcatSpreadable] = false;
console.log("kept whole", describe(small.concat(kept)));
const answered = [1, 2, 3];
Object.defineProperty(answered, 1, { get: () => 9e9, enumerable: true, configurable: true });
console.log("a getter", describe(small.concat(answered)), describe(answered.concat(small)));
class Numbers extends Array {}
const own = Numbers.from([1, 2]);
console.log("a subclass", describe(own.concat(large)), own.concat(small) instanceof Numbers);
console.log("a proxy", describe(small.concat(new Proxy([8e9, 1], {}))));
console.log("arguments", describe((function () { return small.concat(arguments, Array.from(arguments)); })(4e9, 5)));

function calledOtherwise(n) {
  const concat = small.concat;
  const bound = small.concat.bind(small);
  const boundWithNumber = small.concat.bind(small, n);
  const values = [n, n + 1];
  return [
    Array.prototype.concat.call(small, n),
    Array.prototype.concat.call(small, few, n),
    Array.prototype.concat.apply(small, [n]),
    Array.prototype.concat.apply(small, values),
    Reflect.apply(Array.prototype.concat, small, [few, n]),
    concat.call(small, n),
    bound(n),
    bound(few, n),
    boundWithNumber(),
    boundWithNumber(few),
    small.concat(...values),
    small.concat(few, ...values),
    small["con" + "cat"](n),
  ];
}
function storedOtherwise(n) {
  const values = [n, n + 1];
  const lists = [[1], [2], [3], [4], [5], [6], [7]];
  Array.prototype.push.call(lists[0], n);
  Array.prototype.push.apply(lists[1], values);
  Reflect.apply(Array.prototype.unshift, lists[2], [n]);
  lists[3].push(...values);
  lists[4].push.bind(lists[4])(n);
  lists[5].push.bind(lists[5], n)();
  lists[6].unshift(1, n);
  return lists;
}
for (const n of [5, 5e9, 0.5]) {
  console.log("called otherwise", n, calledOtherwise(n).map(describe).join(" | "));
  console.log("stored otherwise", n, storedOtherwise(n).map(describe).join(" | "));
}
