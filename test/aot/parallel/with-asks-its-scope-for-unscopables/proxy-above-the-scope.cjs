const seen = [];
const above = new Proxy({}, { has(target, key) { seen.push(String(key)); return false; } });
const scope = Object.create(above); scope.y = 2;
var z = "outer";
with (scope) { console.log(y, z); }
console.log(seen.join());
