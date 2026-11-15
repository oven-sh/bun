function attempt(deed) { try { return deed(); } catch (error) { return error.name; } }
function deed() { class Early { [late.rate]() {} } return Object.getOwnPropertyNames(Early.prototype)[1]; }
const before = attempt(deed);
const late = { rate: 0.2 };
console.log(before, attempt(deed));
