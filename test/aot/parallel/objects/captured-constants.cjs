// A variable of a function that is initialized with a constant once is that constant in the closures made behind it: a minified UMD file keeps its names so. What is made before, stored again or skipped is not.
"use strict";
const log = [];
!(function (root, factory) {
  root.built = factory();
})(log, function () {
  var first = "year",
    second = "month",
    scale = 1e3,
    nothing = void 0,
    mark = "$isDay",
    last = "日";
  var Day = (function () {
    function Day(value) {
      this[first] = value;
      this[mark] = !0;
    }
    var prototype = Day.prototype;
    prototype.get = function (unit) {
      switch (unit) {
        case first:
          return this[first] * scale;
        case second:
          return (this[first] % 12) + 0.5;
        case last:
          return last;
        default:
          return nothing;
      }
    };
    prototype.fields = function () {
      const keys = [];
      for (const key in this) if (Object.hasOwn(this, key)) keys.push(key);
      return keys.join();
    };
    return Day;
  })();
  return Day;
});
const day = new log.built(2026);
log.push(day.get("year"), day.get("month"), day.get("日"), day.get("week"), day.fields(), day.$isDay);

function hoisted() {
  const early = read();
  var name = "late";
  return [early, read()];
  function read() {
    return typeof name + name;
  }
}
function skipped(runs) {
  if (runs) {
    var name = "set";
  }
  return () => name;
}
function repeated() {
  const read = [];
  for (let i = 0; i < 2; i++) {
    read.push(() => name);
    var name = "again";
  }
  return read.map((f) => f());
}
function storedLater(value) {
  var name = "first";
  const read = () => name;
  if (value) name = value;
  return read;
}
function inSwitch(value) {
  switch (value) {
    case 1:
      var name = "one";
    default:
      return () => name;
  }
}
function shadowed() {
  var name = "outer";
  {
    let name = "inner";
    log.push((() => name)());
  }
  return (name => () => name)(name + "!");
}
log.push(...hoisted(), skipped(true)(), skipped(false)(), ...repeated(), storedLater()(), storedLater("second")(), inSwitch(1)(), inSwitch(2)(), shadowed()());
function* steps() {
  var step = 0.25;
  yield () => step * 2;
  yield (() => () => step)()();
}
const [half, quarter] = steps();
log.push(half(), quarter);
delete log.built;
console.log(log.join("\n"));
