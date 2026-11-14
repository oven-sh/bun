globalThis.said?.push('run cr');
const dep = require('./dep.mjs');
exports.seen = () => dep.x;
