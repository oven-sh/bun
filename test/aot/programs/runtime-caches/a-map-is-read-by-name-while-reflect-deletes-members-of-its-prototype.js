// The size of a Map is read by name while Reflect.deleteProperty() takes members off its prototype and many names are added and deleted.
const map = JSON.parse("[1]", function (k, v) { return k === "" ? new Map([[1, "one"]]) : v; });
function size(o) { return o.size; }
function absent(o) { return o.nothingOfThisName; }
function drop(proto, names) { for (const name of names) Reflect.deleteProperty(proto, name); }
function churn(proto, tag) { for (let i = 0; i < 300; i++) { proto[tag + i] = i; delete proto[tag + i]; } }
const odd = [{}, { a: 1 }, function () {}];
for (let i = 0; i < 60; i++) { size(map); for (const o of odd) size(o); }
console.log("before:", size(map));
drop(Map.prototype, ["getOrInsert", "getOrInsertComputed"]);
churn(Map.prototype, "z");
console.log("churned:", size(map));
for (let i = 0; i < 40; i++) absent(map);
console.log("walked:", size(map));
