globalThis.timesTheCounterRan = (globalThis.timesTheCounterRan || 0) + 1;
let n = 0;
exports.next = () => ++n;
