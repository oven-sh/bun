globalThis.said?.push('run k');
const dep = require('./dep.mjs');
exports.seen = () => dep.x;
