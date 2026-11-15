console.log('legacy.cjs runs');
const s = require('./store.mjs');
exports.size = () => s.store.size;
