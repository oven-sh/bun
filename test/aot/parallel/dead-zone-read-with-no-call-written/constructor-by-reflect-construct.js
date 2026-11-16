function attempt(deed) { try { return deed(); } catch (error) { return error.name; } }
function Early() { this.rate = late.rate; }
function deed() { return Reflect.construct(Early, []).rate; }
const before = attempt(deed);
const late = { rate: 0.2 };
console.log(before, attempt(deed));
