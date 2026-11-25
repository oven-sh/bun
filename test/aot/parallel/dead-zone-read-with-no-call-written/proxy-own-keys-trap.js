function attempt(deed) { try { return deed(); } catch (error) { return error.name; } }
const early = new Proxy({}, { ownKeys() { return [String(late.rate)]; }, getOwnPropertyDescriptor() { return { value: 1, enumerable: true, configurable: true }; } });
function deed() { return Object.keys(early)[0]; }
const before = attempt(deed);
const late = { rate: 0.2 };
console.log(before, attempt(deed));
