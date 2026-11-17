function attempt(deed) { try { return deed(); } catch (error) { return error.name; } }
class Early { get #rate() { return late.rate; } read() { return this.#rate; } }
const early = new Early();
function deed() { return early.read(); }
const before = attempt(deed);
const late = { rate: 0.2 };
console.log(before, attempt(deed));
