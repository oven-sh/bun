// A variable of a function that is initialized with a constant once is that constant in the closures made behind it: a file made smaller keeps its names so. What is made before, stored again or skipped is not.
"use strict";
const log = [];
(function (shop, make) {
  shop.made = make();
})(log, function () {
  var aisle = "aisle",
    shelf = "shelf",
    grams = 1e3,
    none = void 0,
    sign = "#crate",
    lid = "箱";
  var Crate = (function () {
    function Crate(kilos) {
      this[sign] = !0;
      this[aisle] = kilos;
    }
    var above = Crate.prototype;
    above.names = function () {
      const keys = [];
      for (const key in this) if (Object.hasOwn(this, key)) keys.push(key);
      return keys.join();
    };
    above.tell = function (what) {
      switch (what) {
        case lid:
          return lid;
        case shelf:
          return (this[aisle] % 9) + 0.25;
        case aisle:
          return this[aisle] * grams;
        default:
          return none;
      }
    };
    return Crate;
  })();
  return Crate;
});
const crate = new log.made(417);
log.push(crate.names(), crate.tell("箱"), crate.tell("aisle"), crate.tell("shelf"), crate.tell("cellar"), crate["#crate"]);

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
delete log.made;
console.log(log.join("\n"));
