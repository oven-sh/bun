// The size of a Map that structuredClone() made is read by name, while its prototype loses members and is given and robbed of many names.
const map = structuredClone(new Map([[1, "one"]]));
function size(o) { return o.size; }
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
