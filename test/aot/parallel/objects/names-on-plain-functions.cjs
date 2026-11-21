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
const Kitchen = {};
(function () {
  function Weights() {}
  function Scales(plates) {
    Scales.hung.call(this, plates);
  }
  Kitchen.Weights = Weights;
  Kitchen.Scales = Scales;
})();
(function () {
  const Scales = Kitchen.Scales, Weights = Kitchen.Weights;
  Weights.step = 0.5;
  Weights.least = 0.125;
  Scales.hung = function () {};
  Scales.rounded = function (grams, step) {
    const rest = grams % step;
    return rest + rest < step ? grams - rest : grams - rest + step;
  };
  Scales.sum = function (bowls) {
    let sum = 0;
    let k = bowls.length;
    while (k-- > 0) sum += Scales.rounded(bowls[k] * 1.3, Weights.step) + Weights.least;
    return sum;
  };
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
console.log(Kitchen.Scales.sum([0, 1, 2, 3]), holders.map((holder) => holder()).join());
Kitchen.Weights.step = 0.75;
console.log(Kitchen.Scales.sum([0, 1, 2, 3]), Kitchen.Weights.none, typeof Kitchen.Scales.hung);
counted.calls = "n";
console.log(counted(1), counted(2));
console.log(new Kitchen.Weights() instanceof Kitchen.Weights, Object.keys(Kitchen.Weights).join(), Object.keys(counted).join(), Object.keys(new Kitchen.Scales(2)).length);
