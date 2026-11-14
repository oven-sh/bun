// STATISTIC: FunctionNamesReadFromMirrors >= 8
"use strict";
const Space = {};
(function () {
  function Vector(x, y) {
    this.x = x;
    this.y = y;
  }
  function Settings() {}
  function Solver(count) {
    this.count = count;
  }
  Space.Vector = Vector;
  Space.Settings = Settings;
  Space.Solver = Solver;
})();
(function () {
  const Vector = Space.Vector, Settings = Space.Settings, Solver = Space.Solver;
  Solver.prototype.solve = function () {
    let sum = 0;
    for (let k = 0; k < this.count; k++) {
      Solver.steps++;
      const limited = Settings.clamp(k * 0.75, Settings.lowest, Settings.highest);
      sum += limited + Vector.dot(Solver.shared, new Vector(limited, k));
      if (Solver.late) sum += Solver.late;
    }
    return sum;
  };
  Vector.dot = function (a, b) {
    return a.x * b.x + a.y * b.y;
  };
  Settings.clamp = function (value, low, high) {
    return value < low ? low : value > high ? high : value;
  };
  Settings.lowest = 0.5;
  Settings.highest = 3;
  Solver.steps = 0;
})();
console.log(typeof Space.Solver.shared, Space.Solver.late);
Space.Solver.shared = new Space.Vector(2, -1);
console.log(new Space.Solver(8).solve(), Space.Solver.steps);
Space.Settings.highest = 1.25;
Space.Solver.late = 100;
console.log(new Space.Solver(8).solve(), Space.Solver.steps);
function lay(holder, value) {
  holder.lowest = value;
}
lay(Space.Settings, "1");
lay({ lowest: 0 }, 7);
console.log(new Space.Solver(3).solve(), Space.Solver.steps, Space.Settings.lowest);
