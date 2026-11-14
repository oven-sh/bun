function attempt(deed) { try { return deed(); } catch (error) { return error.name; } }
const early = { toString() { return "r" + late.rate; } };
function deed() { return [early].join(); }
const before = attempt(deed);
const late = { rate: 0.2 };
console.log(before, attempt(deed));
