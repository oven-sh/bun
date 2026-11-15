function attempt(deed) { try { return deed(); } catch (error) { return error.name; } }
let seen;
const early = new Proxy({}, { set(target, key, value) { seen = late.rate + value; return true; } });
function deed() { early.rate = 1; return seen; }
const before = attempt(deed);
const late = { rate: 0.2 };
console.log(before, attempt(deed));
