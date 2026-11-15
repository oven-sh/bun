function attempt(deed) { try { return deed(); } catch (error) { return error.name; } }
const early = { [Symbol.iterator]() { let turn = 0; return { next() { return { done: turn++ > 0, value: late.rate }; } }; } };
function deed() { return [...early][0]; }
const before = attempt(deed);
const late = { rate: 0.2 };
console.log(before, attempt(deed));
