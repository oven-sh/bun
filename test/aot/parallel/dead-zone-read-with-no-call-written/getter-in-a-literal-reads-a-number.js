function attempt(deed) { try { return deed(); } catch (error) { return error.name; } }
const early = { get rate() { return late; } };
function deed() { return early.rate; }
const before = attempt(deed);
const late = 0.2;
console.log(before, attempt(deed));
