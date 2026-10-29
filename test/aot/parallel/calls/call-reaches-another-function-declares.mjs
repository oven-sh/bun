// call, apply and Reflect.apply reach a function through a bound function, through call itself, through a built-in that runs it for each element, and from two places.
const counters = list => list.map(one => one()).join() + " " + list.map(one => one()).join();

const throughBind = [];
const bound = function (item) {
  let count = item * 10;
  throughBind.push(() => ++count);
}.bind(null);
bound.call(null, 1);
bound.call(null, 2);
console.log(counters(throughBind), new Set(throughBind).size);

const boundEach = [];
[1, 2, 3].forEach.bind([1, 2, 3]).call(null, function (item) {
  let count = item * 10;
  boundEach.push(() => ++count);
});
console.log(counters(boundEach), new Set(boundEach).size);

const throughCallOfCall = [];
Function.prototype.call.call(Array.prototype.forEach, [1, 2, 3], function (item) {
  let count = item * 10;
  throughCallOfCall.push(() => ++count);
});
console.log(counters(throughCallOfCall), new Set(throughCallOfCall).size);

const throughApplyOfCall = [];
Function.prototype.call.apply(Array.prototype.map, [
  [1, 2, 3],
  function (item) {
    class Made {
      static value = item;
    }
    throughApplyOfCall.push(Made);
  },
]);
console.log(throughApplyOfCall.map(one => one.value).join(), throughApplyOfCall[0] === throughApplyOfCall[2]);

const throughReflectOfApply = [];
Reflect.apply(Function.prototype.apply, Array.prototype.filter, [
  [1, 2, 3],
  [
    function (item) {
      function named() {
        return item;
      }
      throughReflectOfApply.push(named);
    },
  ],
]);
console.log(throughReflectOfApply.map(one => one()).join(), throughReflectOfApply[0] === throughReflectOfApply[1]);

const eitherOne = [];
const callback = function (item) {
  let count = (item ?? 0) * 10;
  eitherOne.push(() => ++count);
};
(eitherOne.length ? callback : Array.prototype.forEach).call([1, 2, 3], callback);
console.log(counters(eitherOne), new Set(eitherOne).size);

const receiverAndArgument = [];
const itself = function (other) {
  let count = receiverAndArgument.length * 10;
  receiverAndArgument.push(() => ++count);
  if (other) [1, 2].forEach(() => other.call(null));
};
itself.call(null, itself);
console.log(counters(receiverAndArgument), new Set(receiverAndArgument).size);

const fromTwoPlaces = [];
const reached = function (item) {
  let count = item * 10;
  fromTwoPlaces.push(() => ++count);
};
reached.call(null, 1);
Reflect.apply(reached, null, [2]);
reached.apply(null, [3]);
console.log(counters(fromTwoPlaces), new Set(fromTwoPlaces).size);

const throughSort = [];
Array.prototype.sort.call([3, 1, 2], function (a, b) {
  throughSort.push(() => a - b);
  return a - b;
});
console.log(
  throughSort.length > 1,
  new Set(throughSort).size === throughSort.length,
  throughSort.every(one => typeof one() === "number"),
);

const later = [];
const timer = function (item) {
  let count = item * 10;
  later.push(() => ++count);
};
queueMicrotask.call(null, () => timer.call(null, 1));
queueMicrotask.call(null, () => timer.call(null, 2));
await null;
console.log(counters(later), new Set(later).size);

const once = [];
(function () {
  let count = 0;
  function Kept() {}
  Kept.prototype.next = () => ++count;
  once.push(new Kept(), new Kept());
}).call(globalThis);
(function (tag) {
  let count = 100;
  once.push({ next: () => tag + ++count });
}).apply(null, ["a"]);
Reflect.apply(
  function (tag) {
    let count = 200;
    once.push({ next: () => tag + ++count });
  },
  null,
  ["b"],
);
console.log(once.map(one => one.next()).join(), Object.getPrototypeOf(once[0]) === Object.getPrototypeOf(once[1]));
