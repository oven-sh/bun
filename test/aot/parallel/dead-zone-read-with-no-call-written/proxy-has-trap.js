function attempt(deed) { try { return deed(); } catch (error) { return error.name; } }
const early = new Proxy({}, { has() { return late.rate > 0; } });
function deed() { return "rate" in early; }
const before = attempt(deed);
const late = { rate: 0.2 };
console.log(before, attempt(deed));
