// One function reads the size of a Map and of six other kinds of receivers, while the prototype of Maps loses members.
const map = JSON.parse("[1]", function (k, v) { return k === "" ? new Map([[1, "one"]]) : v; });
function size(o) { return o.size; }
function absent(o) { return o.nothingOfThisName; }
function drop(proto, names) { for (const name of names) delete proto[name]; }
function churn(proto, tag) { for (let i = 0; i < 300; i++) { proto[tag + i] = i; delete proto[tag + i]; } }
const odd = [{}, { a: 1 }, function () {}, [1], { size: "own" }, new Set([1])];
for (let i = 0; i < 60; i++) { size(map); for (const o of odd) size(o); }
console.log("before:", size(map));
drop(Map.prototype, ["getOrInsert", "getOrInsertComputed"]);
churn(Map.prototype, "z");
console.log("churned:", size(map));
for (let i = 0; i < 40; i++) absent(map);
console.log("walked:", size(map));
