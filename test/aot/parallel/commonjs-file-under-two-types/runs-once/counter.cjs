globalThis.runs = (globalThis.runs ?? 0) + 1;
let count = 0;
exports.increment = () => ++count;
