// STATISTIC: FunctionNamesReadFromMirrors >= 8
"use strict";
const Farm = {};
(function () {
  function Field(long, wide) {
    this.wide = wide;
    this.long = long;
  }
  function Rules() {}
  function Farmer(days) {
    this.days = days;
  }
  Farm.Farmer = Farmer;
  Farm.Rules = Rules;
  Farm.Field = Field;
})();
(function () {
  const Farmer = Farm.Farmer, Field = Farm.Field, Rules = Farm.Rules;
  Field.yields = function (one, other) {
    return one.wide * other.long - one.long / other.wide;
  };
  Rules.fewest = 0.5;
  Rules.most = 3;
  Rules.sown = function (seeds, fewest, most) {
    const over = seeds - most;
    if (over > 0) return most - over / 8;
    return seeds + fewest / 2;
  };
  Farmer.worked = 0;
  Farmer.prototype.work = function () {
    let day = this.days, stored = 0;
    while (day > 0) {
      const sown = Rules.sown(day * 0.75, Rules.fewest, Rules.most);
      Farmer.worked += 1;
      stored += Field.yields(new Field(sown, day), Farmer.own) - sown;
      if (Farmer.late) stored -= Farmer.late;
      day--;
    }
    return stored;
  };
})();
console.log(typeof Farm.Farmer.own, Farm.Farmer.late);
Farm.Farmer.own = new Farm.Field(2, -1);
console.log(new Farm.Farmer(8).work(), Farm.Farmer.worked);
Farm.Rules.most = 1.25;
Farm.Farmer.late = 100;
console.log(new Farm.Farmer(8).work(), Farm.Farmer.worked);
function lay(holder, value) {
  holder.fewest = value;
}
lay(Farm.Rules, "1");
lay({ fewest: 0 }, 7);
console.log(new Farm.Farmer(3).work(), Farm.Farmer.worked, Farm.Rules.fewest);
