function attempt(deed) { try { return deed(); } catch (error) { return error.name; } }
const early = { get rate() { return late.rate; } };
function deed() { return Object.entries(early)[0][1]; }
const before = attempt(deed);
const late = { rate: 0.2 };
console.log(before, attempt(deed));
