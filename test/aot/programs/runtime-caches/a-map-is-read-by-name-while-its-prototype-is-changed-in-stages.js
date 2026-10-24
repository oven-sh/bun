// The size of a Map is read by name while names are added to its prototype and deleted in three stages, with reads of an absent name between them.
const map = JSON.parse("[1]", function (k, v) { return k === "" ? new Map([[1, "one"]]) : v; });
function size(o) { return o.size; }
function absent(o) { return o.nothingOfThisName; }
function drop(proto, names) { for (const name of names) delete proto[name]; }
function churn(proto, tag) { for (let i = 0; i < 300; i++) { proto[tag + i] = i; delete proto[tag + i]; } }
const odd = [{}, { a: 1 }, function () {}];
for (let i = 0; i < 60; i++) { size(map); for (const o of odd) size(o); }
console.log("before:", size(map));
drop(Map.prototype, ["getOrInsert", "getOrInsertComputed"]);
function churnBy(proto, tag, n) { for (let i = 0; i < n; i++) { proto[tag + i] = i; delete proto[tag + i]; } }
for (const n of [10, 70, 300]) { churnBy(Map.prototype, "z" + n, n); for (let i = 0; i < 40; i++) absent(map); console.log(n, size(map)); }
console.log("churned:", size(map));
for (let i = 0; i < 40; i++) absent(map);
console.log("walked:", size(map));
