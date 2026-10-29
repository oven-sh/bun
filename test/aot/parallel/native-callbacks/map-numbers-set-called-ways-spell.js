// Map.prototype.set through call, apply, Reflect.apply, bind, a computed name and a callback, each with a number that is no int32.
const log = [];
const map = new Map(); map.set("plain", 1);
Map.prototype.set.call(map, "call", 2147483648);
Map.prototype.set.apply(map, ["apply", 0.25]);
Reflect.apply(Map.prototype.set, map, ["reflect", -4294967297]);
const bound = map.set.bind(map, "bound"); bound(1e300);
const method = "se" + (process.argv.length > 99 ? "x" : "t"); map[method]("computed", 3000000000);
[["each", 5000000000]].forEach(([key, value]) => map.set(key, value));
for (const key of map.keys()) log.push(key + "=" + (map.get(key) + 1) + "|" + (map.get(key) | 0));
console.log(log.join("; "));
