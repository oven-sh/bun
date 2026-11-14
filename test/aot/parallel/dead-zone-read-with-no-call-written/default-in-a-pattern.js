function attempt(deed) { try { return deed(); } catch (error) { return error.name; } }
function deed() { const { rate = late.rate } = {}; return rate; }
const before = attempt(deed);
const late = { rate: 0.2 };
console.log(before, attempt(deed));
