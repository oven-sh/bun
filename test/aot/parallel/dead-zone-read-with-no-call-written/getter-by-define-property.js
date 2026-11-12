function attempt(deed) { try { return deed(); } catch (error) { return error.name; } }
const early = {};
Object.defineProperty(early, "rate", { get() { return late.rate; }, configurable: true });
function deed() { return early.rate; }
const before = attempt(deed);
const late = { rate: 0.2 };
console.log(before, attempt(deed));
