// Members of a Map are read by name in functions called out of a list, while its prototype loses members and is given and robbed of many names.
const map = JSON.parse("[1]", function (k, v) { return k === "" ? new Map([[1, "one"]]) : v; });
function size0(o) { return o.size; }
const readers = [size0, o => o.values];
function size(o) { let r; for (const read of readers) r = String(read(o)).length; return r; }
function absent(o) { return o.nothingOfThisName; }
function drop(proto, names) { for (const name of names) delete proto[name]; }
function churn(proto, tag) { for (let i = 0; i < 300; i++) { proto[tag + i] = i; delete proto[tag + i]; } }
const odd = [{}, { a: 1 }, function () {}];
for (let i = 0; i < 60; i++) { size(map); for (const o of odd) size(o); }
console.log("before:", size(map));
drop(Map.prototype, ["getOrInsert", "getOrInsertComputed"]);
churn(Map.prototype, "z");
console.log("churned:", size(map));
for (let i = 0; i < 40; i++) absent(map);
console.log("walked:", size(map));
