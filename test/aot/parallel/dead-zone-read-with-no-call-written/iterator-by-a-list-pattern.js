function attempt(deed) { try { return deed(); } catch (error) { return error.name; } }
const early = { [Symbol.iterator]() { return { next() { return { done: false, value: late.rate }; } }; } };
function deed() { const [first] = early; return first; }
const before = attempt(deed);
const late = { rate: 0.2 };
console.log(before, attempt(deed));
