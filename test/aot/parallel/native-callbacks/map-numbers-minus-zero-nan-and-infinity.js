// -0, NaN and Infinity as values of a Map, from a literal and from set.
const log = [];
const map = new Map(Object.entries({ zero: -0, nan: NaN, up: Infinity, one: 1 })); map.set("set", -0);
log.push(Object.is(map.get("zero"), -0), Object.is(map.get("set"), -0), 1 / map.get("zero"), map.get("nan") !== map.get("nan"), map.get("up") - 1, map.get("one") / map.get("set"), map.get("nan") | 0);
console.log(log.join("; "));
