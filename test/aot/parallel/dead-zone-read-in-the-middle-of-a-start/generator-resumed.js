function read() { try { return late.rate; } catch (error) { return error.name; } }
let seen = "not run";
function* steps() { yield 1; seen = read(); }
const walked = steps();
walked.next();
walked.next();
const late = { rate: 0.2 };
console.log(seen, read());
