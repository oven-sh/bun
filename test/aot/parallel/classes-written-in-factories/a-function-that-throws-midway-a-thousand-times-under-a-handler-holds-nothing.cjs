// STATISTIC: CapturesOfClassesStoredForGoodPromoted = 0
"use strict";
const refs = [], out = [];
const n = +process.argv[2] || 1000;
const trips = JSON.parse("true");
let failed = 0;
function make(exports, turn) {
  var table = { rows: new Array(200).fill(turn) };
  refs.push(new WeakRef(table));
  var Keeper = function Keeper() { this.rows = table.rows.length; };
  Keeper.prototype.first = function () { return table.rows[0] + this.rows; };
  if (trips) throw new Error("midway");
  exports.Keeper = Keeper;
}
for (let turn = 0; turn < n; turn++) { try { make({}, turn); } catch (error) { failed++; } }
setTimeout(() => {
  Bun.gc(true);
  setTimeout(() => {
    Bun.gc(true);
    const alive = refs.filter(ref => ref.deref() !== undefined).length;
    console.log(failed, refs.length, "alive:", alive <= 2 ? "none" : alive);
  }, 5);
}, 60);
