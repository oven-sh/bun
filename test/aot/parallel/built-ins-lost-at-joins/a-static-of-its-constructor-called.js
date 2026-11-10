const given = JSON.parse(process.argv[2] ?? "5");
const own = Object.getPrototypeOf(given);
console.log(own.constructor.isInteger(5), own.constructor.parseFloat("1.5"));
