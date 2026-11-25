function attempt(deed) { try { return deed(); } catch (error) { return error.name; } }
const early = { get rate() { return late.rate; } };
const key = ["ra", "te"].join("");
function deed() { return early[key]; }
const before = attempt(deed);
const late = { rate: 0.2 };
console.log(before, attempt(deed));
