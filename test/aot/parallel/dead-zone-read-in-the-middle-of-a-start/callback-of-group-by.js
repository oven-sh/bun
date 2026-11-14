function read() { try { return late.rate; } catch (error) { return error.name; } }
let seen = "not run";
Object.groupBy([1], () => { seen = read(); return "k"; });
const late = { rate: 0.2 };
console.log(seen, read());
