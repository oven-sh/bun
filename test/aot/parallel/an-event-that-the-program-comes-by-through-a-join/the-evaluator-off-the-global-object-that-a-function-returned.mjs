function id(x) { return x; }
const g = id(globalThis);
const F = Date.now() > 0 ? g.Function : Math.abs;
const n = F("return [1, 2, 3].map(x => x * 2).length")();
console.log(n === 3 ? "three" : "other");
