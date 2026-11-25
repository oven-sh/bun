function attempt(deed) { try { return deed(); } catch (error) { return error.name; } }
const early = { [Symbol.iterator]() { return { next() { return { done: false, value: 1 }; }, return() { late.rate; return {}; } }; } };
function deed() { for (const value of early) break; return "left"; }
const before = attempt(deed);
const late = { rate: 0.2 };
console.log(before, attempt(deed));
