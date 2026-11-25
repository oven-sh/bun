function attempt(deed) { try { return deed(); } catch (error) { return error.name; } }
const early = { other: 1, get rate() { return late.rate; } };
function deed() { const { other, ...rest } = early; return rest.rate; }
const before = attempt(deed);
const late = { rate: 0.2 };
console.log(before, attempt(deed));
