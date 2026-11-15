function attempt(deed) { try { return deed(); } catch (error) { return error.name; } }
class Early { static get rate() { return late.rate; } }
function deed() { return Early.rate; }
const before = attempt(deed);
const late = { rate: 0.2 };
console.log(before, attempt(deed));
