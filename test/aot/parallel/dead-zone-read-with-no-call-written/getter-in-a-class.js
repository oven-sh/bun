function attempt(deed) { try { return deed(); } catch (error) { return error.name; } }
class Early { get rate() { return late.rate; } }
const early = new Early();
function deed() { return early.rate; }
const before = attempt(deed);
const late = { rate: 0.2 };
console.log(before, attempt(deed));
