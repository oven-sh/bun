function attempt(deed) { try { return deed(); } catch (error) { return error.name; } }
function deed() { return "a".replace("a", () => String(late.rate)); }
const before = attempt(deed);
const late = { rate: 0.2 };
console.log(before, attempt(deed));
