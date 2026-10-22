// A call with a list that has holes, is long, or has another storage is made by native code. The callees are closures that nothing but calls uses.
function count() { return arguments.length; }
function last() { return arguments[arguments.length - 1]; }
function Counted() { this.count = arguments.length; }

for (const length of [6, 7, 4096, 4097, 10000]) {
  const list = Array.from({ length }, (unused, index) => index);
  console.log(length, count(...list), last.apply(null, list), (function () { return arguments.length; })(...list), new Counted(...list).count);
}

const holey = [1, , 3];
console.log(count(...holey), last.apply(null, holey), (function () { return arguments[1]; })(...holey), (() => 7)(...holey), new Counted(...holey).count);

const sparse = [];
sparse[5000] = "end";
console.log(count(...sparse), last.apply(null, sparse), (function (first) { return first; })(...sparse));

const withGetter = [1, 2];
Object.defineProperty(withGetter, 0, { get() { return "got"; } });
console.log(count(...withGetter), (function (first) { return first; }).apply(null, withGetter));

const doubles = [0.5, , 2.5];
console.log(last.apply(null, doubles), (function (a, b) { return b; })(...doubles));

function outer(list) {
  let captured = 10;
  const add = function () { return captured + arguments.length; };
  return add(...list) + add.apply(null, list);
}
console.log(outer(holey), outer(sparse));
