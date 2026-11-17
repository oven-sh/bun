function attempt(deed) { try { return deed(); } catch (error) { return error.name; } }
const early = [2, 1];
function deed() { return early.slice().sort((a, b) => a - b + 0 * late.rate)[0]; }
const before = attempt(deed);
const late = { rate: 0.2 };
console.log(before, attempt(deed));
