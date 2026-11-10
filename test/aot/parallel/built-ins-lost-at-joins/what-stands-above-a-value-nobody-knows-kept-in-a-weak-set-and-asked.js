const given = JSON.parse(process.argv[2] ?? "5");
const own = Object.getPrototypeOf(given);
const known = new WeakSet();
known.add(own);
console.log(known.has(Number.prototype));
console.log((5).toFixed(1), typeof own);
