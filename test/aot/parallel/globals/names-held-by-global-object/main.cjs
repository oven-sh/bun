// What files store on the global object under names, read by every way of naming it, before and behind stores that nobody follows.
var store = require("./store.cjs");
function read() {
  var out = [], t = 0;
  for (var i = 0; i < 20; i++) { try { t += heldPoint.sum() + heldList[i % 3] + heldFunction(i); } catch (e) { t = e.name; break; } }
  out.push(t);
  var ways = [
    function () { return globalThis.heldPoint.x; }, function () { return self.heldList && self.heldList.length; },
    function () { return heldBySloppyThis.n; }, function () { return undeclaredName.n; }, function () { return typeof undeclaredName; },
    function () { return heldByWrapper.make(heldByWrapper.n).n; }, function () { return typeof neverStored; }, function () { return neverStored; },
    function () { return typeof lateName; }, function () { return lateName.n; }, function () { return (function () { return typeof this.neverStored; })(); },
    function () { return "heldPoint" in globalThis; }, function () { return Object.keys(globalThis).filter(function (k) { return /^held|undeclaredName|lateName/.test(k); }).join(); },
  ];
  for (var way of ways) try { out.push(String(way())); } catch (e) { out.push(e.name + " " + e.message); }
  return out.join(" | ");
}
console.log(read());
heldPoint.x = 0.5; console.log(read());
heldPoint.added = 1; heldList.push(4); heldList[0] = "t"; console.log(read());
for (var way = 0; way < 8; way++) { store.replace(way); console.log(way, read()); }
store.Point.prototype.sum = function () { return 3; }; heldPoint = new store.Point(1, 1); console.log(read());
