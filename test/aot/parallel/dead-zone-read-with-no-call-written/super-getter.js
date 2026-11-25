function attempt(deed) { try { return deed(); } catch (error) { return error.name; } }
class Above { get rate() { return late.rate; } }
class Early extends Above { read() { return super.rate; } }
const early = new Early();
function deed() { return early.read(); }
const before = attempt(deed);
const late = { rate: 0.2 };
console.log(before, attempt(deed));
