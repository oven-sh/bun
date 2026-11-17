function attempt(deed) { try { return deed(); } catch (error) { return error.name; } }
const early = new Map([["rate", function () { return late.rate; }]]);
function deed() { return early.get("rate")(); }
const before = attempt(deed);
const late = { rate: 0.2 };
console.log(before, attempt(deed));
