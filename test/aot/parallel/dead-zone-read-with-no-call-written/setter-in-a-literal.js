function attempt(deed) { try { return deed(); } catch (error) { return error.name; } }
let seen;
const early = { set rate(value) { seen = late.rate + value; } };
function deed() { early.rate = 1; return seen; }
const before = attempt(deed);
const late = { rate: 0.2 };
console.log(before, attempt(deed));
