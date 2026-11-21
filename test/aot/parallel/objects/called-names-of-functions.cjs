// STATISTIC: FunctionNamesReadFromMirrors >= 4
"use strict";
const Mill = {};
(function () {
  function Stones() {}
  function Sack(weight) {
    this.weight = weight;
  }
  Mill.Sack = Sack;
  Mill.Stones = Stones;
})();
(function () {
  const Sack = Mill.Sack, Stones = Mill.Stones;
  Stones.worn = function (grain, turns, most) {
    const left = grain - turns / 8;
    if (left !== left) return most;
    return Math.min(left, most);
  };
  Stones.ground = function (first, second, share) {
    return Stones.worn(second, 2, 9) * share - Stones.worn(first, 1, 12) / 4;
  };
  Sack.filled = function (sack, by) {
    sack.weight = Stones.worn(sack.weight + by, 3, 50);
    return sack;
  };
  Mill.run = function (days, loads) {
    let flour = 0;
    for (let day = days; day > 0; day--) {
      const sack = new Sack(day + 0.5);
      let load = loads;
      while (load-- > 0) flour += Stones.ground(Sack.filled(sack, 1.5).weight, load, 0.25);
      flour += Stones.worn(flour, 8, 1);
    }
    return flour;
  };
})();
console.log(Mill.run(6, 3), Mill.run(2, 9));
const worn = Mill.Stones.worn;
Mill.Stones.worn = function (grain) {
  return worn(grain, 2, 4);
};
console.log(Mill.run(6, 3));
Mill.Stones.worn = undefined;
try {
  console.log(Mill.run(6, 3));
} catch (error) {
  console.log(error.constructor.name);
}
Mill.Stones.worn = worn;
console.log(Mill.run(6, 3));
