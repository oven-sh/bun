let count = 0;
const made = { at: ++globalThis.runsOfCounter || (globalThis.runsOfCounter = 1) };
function bump() { return ++count; }
module.exports = { bump, read: () => count, made };
