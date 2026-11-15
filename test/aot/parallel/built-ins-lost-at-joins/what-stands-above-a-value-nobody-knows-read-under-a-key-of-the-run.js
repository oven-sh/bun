const given = JSON.parse(process.argv[2] ?? "5");
const own = Object.getPrototypeOf(given);
console.log(typeof own[process.argv[3] ?? "toExponential"]);
console.log(own[process.argv[3] ?? "toExponential"].call(5, 1));
console.log((5).toFixed(1), typeof own);
