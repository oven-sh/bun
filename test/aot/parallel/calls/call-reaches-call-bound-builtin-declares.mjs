// One call finds Function.prototype.call, apply or Reflect.apply, or under the same name a bound built-in that runs its argument for each element.
const counters = list => list.map(one => one()).join() + " " + list.map(one => one()).join();

const underCall = [];
const first = function (item) {
  let count = (item ?? 0) * 10;
  underCall.push(() => ++count);
};
const eachUnderCall = { call: Array.prototype.forEach.bind([1, 2, 3]) };
(underCall.length ? first : eachUnderCall).call(first);
console.log(counters(underCall), new Set(underCall).size);

const underApply = [];
const second = function (item) {
  class Made {
    static value = item;
  }
  underApply.push(Made);
};
const mapUnderApply = { apply: Array.prototype.map.bind([1, 2, 3]) };
(underApply.length ? second : mapUnderApply).apply(second);
console.log(underApply.map(one => one.value).join(), underApply[0] === underApply[2]);

const underReflect = [];
const third = function (item) {
  function named() {
    return item;
  }
  underReflect.push(named);
};
const filterUnderApply = { apply: Array.prototype.filter.bind([1, 2, 3]) };
(underReflect.length ? Reflect : filterUnderApply).apply(third, undefined, []);
console.log(underReflect.map(one => one()).join(), underReflect[0] === underReflect[1]);

const underBoundCall = [];
const fourth = function (item) {
  let count = (item ?? 0) * 10;
  underBoundCall.push(() => ++count);
};
const callOfEach = { call: Function.prototype.call.bind(Array.prototype.forEach, [1, 2, 3]) };
(underBoundCall.length ? fourth : callOfEach).call(fourth);
console.log(counters(underBoundCall), new Set(underBoundCall).size);

const underBoundOfBound = [];
const fifth = function (item) {
  let count = (item ?? 0) * 10;
  underBoundOfBound.push(() => ++count);
};
const boundTwice = { call: Array.prototype.forEach.bind([1, 2, 3]).bind(null) };
(underBoundOfBound.length ? fifth : boundTwice).call(fifth);
console.log(counters(underBoundOfBound), new Set(underBoundOfBound).size);

const theOtherWay = [];
const sixth = function (item) {
  let count = (item ?? 0) * 10;
  theOtherWay.push(() => ++count);
};
const neverTaken = { call: Array.prototype.forEach.bind([1, 2, 3]) };
(theOtherWay.length ? neverTaken : sixth).call(sixth, 4);
console.log(counters(theOtherWay), new Set(theOtherWay).size);
