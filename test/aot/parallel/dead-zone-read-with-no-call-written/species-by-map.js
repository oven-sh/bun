function attempt(deed) { try { return deed(); } catch (error) { return error.name; } }
class Early extends Array { static get [Symbol.species]() { late.rate; return Array; } }
const early = new Early(1);
function deed() { return early.map(x => x).length; }
const before = attempt(deed);
const late = { rate: 0.2 };
console.log(before, attempt(deed));
