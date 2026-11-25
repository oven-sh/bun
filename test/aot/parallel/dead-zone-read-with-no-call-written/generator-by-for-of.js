function attempt(deed) { try { return deed(); } catch (error) { return error.name; } }
function* early() { yield late.rate; }
function deed() { for (const value of early()) return value; }
const before = attempt(deed);
const late = { rate: 0.2 };
console.log(before, attempt(deed));
