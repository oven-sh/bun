function attempt(deed) { try { return deed(); } catch (error) { return error.name; } }
const above = { get rate() { return late.rate; } };
const early = Object.create(above);
function deed() { return early.rate; }
const before = attempt(deed);
const late = { rate: 0.2 };
console.log(before, attempt(deed));
