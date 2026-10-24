// `filter` of a typed array makes an array of the class of its receiver: above the result lies Float64Array.prototype, not the prototype object that all typed arrays share. Asked in place, at the top of the
// module and in functions, with no other class of typed array in the program: a compiler that takes the result for "some typed array" folds the comparisons the wrong way, and the object itself is right.
const subject = new Float64Array([1.5, 2.5, 3.5]);
const result = subject.filter(() => true);
const above = Object.getPrototypeOf(result);
console.log("at the top:", above === Float64Array.prototype, above === Object.getPrototypeOf(Float64Array.prototype), above === null, typeof above, Object.getOwnPropertyNames(above).includes("BYTES_PER_ELEMENT"));

function inAFunction() {
  const list = new Float64Array([1.5, 2.5, 3.5]);
  function keep() {
    return true;
  }
  const kept = list.filter(keep);
  console.log("in a function:", Object.getPrototypeOf(kept) === Object.prototype, Object.getPrototypeOf(kept) === Array.prototype, Object.getPrototypeOf(kept) === null, Object.getPrototypeOf(kept) === Float64Array.prototype);
  console.log("by other questions:", kept instanceof Float64Array, kept.constructor === Float64Array, Float64Array.prototype.isPrototypeOf(kept), Reflect.getPrototypeOf(kept) === Float64Array.prototype, kept.__proto__ === Float64Array.prototype, kept.BYTES_PER_ELEMENT);
}
inAFunction();

function ofAParameter(list) {
  const kept = list.filter(value => value > 2);
  return [Object.getPrototypeOf(kept) === Float64Array.prototype, Object.getPrototypeOf(kept) === Object.getPrototypeOf(list), kept.length];
}
console.log("of a parameter:", ...ofAParameter(new Float64Array([1.5, 2.5, 3.5])));
