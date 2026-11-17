function attempt(deed) { try { return deed(); } catch (error) { return error.name; } }
function early() { return late.rate; }
function deed() { return early.apply(null, []); }
const before = attempt(deed);
const late = { rate: 0.2 };
console.log(before, attempt(deed));
