function attempt(deed) { try { return deed(); } catch (error) { return error.name; } }
class Early { static read() { return late.rate; } }
function deed() { return Early.read(); }
const before = attempt(deed);
const late = { rate: 0.2 };
console.log(before, attempt(deed));
