function attempt(deed) { try { return deed(); } catch (error) { return error.name; } }
const early = { [Symbol.hasInstance]() { return late.rate > 0; } };
function deed() { return ({}) instanceof early; }
const before = attempt(deed);
const late = { rate: 0.2 };
console.log(before, attempt(deed));
