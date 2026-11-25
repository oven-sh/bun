const given = JSON.parse(process.argv[2] ?? "5");
const own = Object.getPrototypeOf(given);
console.log(own.toFixed.call(7, 2));
console.log((5).toFixed(1), typeof own);
