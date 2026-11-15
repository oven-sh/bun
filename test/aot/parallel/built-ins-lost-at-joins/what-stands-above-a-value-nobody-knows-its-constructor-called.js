const given = JSON.parse(process.argv[2] ?? "5");
const own = Object.getPrototypeOf(given);
console.log(own.constructor("12") + 1);
console.log((5).toFixed(1), typeof own);
