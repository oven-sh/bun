// STATISTIC: FunctionNamesReadFromMirrors >= 5
"use strict";
function counted(step) {
  counted.calls += step;
  return counted.calls;
}
counted.calls = 0;
const squares = (value) => {
  if (squares.found[value] === undefined) squares.found[value] = value * value;
  return squares.found[value];
};
squares.found = {};
const Space = {};
(function () {
  function Maths() {
    Maths.Maths.apply(this, arguments);
  }
  function Limits() {}
  Space.Maths = Maths;
  Space.Limits = Limits;
})();
(function () {
  const Maths = Space.Maths, Limits = Space.Limits;
  Maths.Maths = function () {};
  Maths.clamp = function (value, low, high) {
    return value < low ? low : value > high ? high : value;
  };
  Maths.sum = function (list) {
    let sum = 0;
    for (let k = 0; k < list.length; k++) sum += Maths.clamp(list[k], Limits.low, Limits.high);
    return sum;
  };
  Limits.low = 0.25;
  Limits.high = 2;
})();
function made(count) {
  function holder() {
    return holder.value;
  }
  holder.value = count;
  return holder;
}
const holders = [];
for (let k = 0; k < 3; k++) {
  const inLoop = function () {
    return inLoop.value;
  };
  inLoop.value = k * 10;
  holders.push(inLoop, made(k));
}
let total = 0;
for (let k = 0; k < 20; k++) total += counted(k) + squares(k % 4);
console.log(total, counted.calls, Object.keys(squares.found).join());
console.log(Space.Maths.sum([0, 1, 2, 3]), holders.map((holder) => holder()).join());
Space.Limits.high = 1.5;
console.log(Space.Maths.sum([0, 1, 2, 3]), Space.Limits.none, typeof Space.Maths.Maths);
counted.calls = "n";
console.log(counted(1), counted(2));
console.log(new Space.Limits() instanceof Space.Limits, Object.keys(Space.Limits).join(), Object.keys(counted).join());
