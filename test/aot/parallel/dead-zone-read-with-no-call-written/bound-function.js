function attempt(deed) { try { return deed(); } catch (error) { return error.name; } }
const early = function () { return late.rate; }.bind(null);
function deed() { return early(); }
const before = attempt(deed);
const late = { rate: 0.2 };
console.log(before, attempt(deed));
