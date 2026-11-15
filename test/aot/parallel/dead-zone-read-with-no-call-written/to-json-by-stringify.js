function attempt(deed) { try { return deed(); } catch (error) { return error.name; } }
const early = { toJSON() { return late.rate; } };
function deed() { return JSON.stringify(early); }
const before = attempt(deed);
const late = { rate: 0.2 };
console.log(before, attempt(deed));
