function attempt(deed) { try { return deed(); } catch (error) { return error.name; } }
Object.defineProperty(globalThis, "earlyRate", { get() { return late.rate; }, configurable: true });
function deed() { return earlyRate; }
const before = attempt(deed);
const late = { rate: 0.2 };
console.log(before, attempt(deed));
