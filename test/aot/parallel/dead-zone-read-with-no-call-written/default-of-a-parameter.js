function attempt(deed) { try { return deed(); } catch (error) { return error.name; } }
function early(rate = late.rate) { return rate; }
function deed() { return early(); }
const before = attempt(deed);
const late = { rate: 0.2 };
console.log(before, attempt(deed));
