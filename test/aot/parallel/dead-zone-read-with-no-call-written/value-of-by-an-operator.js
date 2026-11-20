function attempt(deed) { try { return deed(); } catch (error) { return error.name; } }
const early = { valueOf() { return late.rate; } };
function deed() { return early * 2; }
const before = attempt(deed);
const late = { rate: 0.2 };
console.log(before, attempt(deed));
