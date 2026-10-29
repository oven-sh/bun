// @ts-nocheck
// Two lists reach each function, one that holds a number and one that holds none. Nobody checks the file, and the annotations stay.
// The first element is read in a function that a built-in function calls, or in a field of a class.
function keyOfAGroup(a: (number | null)[]) {
  return [...Map.groupBy([1], () => a[0]).keys()];
}
console.log("null first", keyOfAGroup([null]), keyOfAGroup([1.5]));

function theNumberFirst(a: (number | null)[]) {
  return [...Map.groupBy([1], () => a[0]).keys()];
}
console.log("the number first", theNumberFirst([1.5]), theNumberFirst([null]));

function orUndefined(a: (number | undefined)[]) {
  return [...Map.groupBy([1], () => a[0]).keys()];
}
console.log("or undefined", orUndefined([undefined]), orUndefined([1.5]));

function aWholeNumber(a: (number | null)[]) {
  return [...Map.groupBy([1], () => a[0]).keys()];
}
console.log("a whole number", aWholeNumber([null]), aWholeNumber([3]));

function manyNumbers(a: (number | null)[]) {
  return [...Map.groupBy([1], () => a[0]).keys()];
}
console.log(
  "many",
  manyNumbers([null]),
  manyNumbers([1e300]),
  manyNumbers([-1.5]),
  manyNumbers([NaN]),
  manyNumbers([0.1]),
);

function inAFunctionExpression(a: (number | null)[]) {
  return [
    ...Map.groupBy([1], function () {
      return a[0];
    }).keys(),
  ];
}
console.log("a function expression", inAFunctionExpression([null]), inAFunctionExpression([1.5]));

function inAField(a: (number | null)[]) {
  return new (class {
    v = a[0];
  })().v;
}
console.log("a field", inAField([null]), inAField([1.5]));

function inANamedClass(a: (number | null)[]) {
  class K {
    n = a[0];
  }
  const k = new K();
  return [k.n, typeof k.n, Object.keys(k)];
}
console.log("a named class", inANamedClass([null]), inANamedClass([1.5]));

function intoATypedArray(a: (number | null)[]) {
  return new Float64Array(1).map(() => a[0]);
}
console.log("a typed array", intoATypedArray([null]), intoATypedArray([1.5]));

function addedInATypedArray(a: (number | null)[]) {
  return new Float64Array([1.5, 2.5]).map(v => v + a[0]);
}
console.log("added in a typed array", addedInATypedArray([null]), addedInATypedArray([1.5]));

function fromALength(a: (number | null)[]) {
  return Array.from({ length: 2 }, (_, i) => i + a[0]);
}
console.log("from a length", fromALength([null]), fromALength([1.5]));

function overAFilledList(a: (number | null)[]) {
  return new Array(3).fill(0).map((_, i) => i * a[0]);
}
console.log("over a filled list", overAFilledList([null]), overAFilledList([1.5]));
