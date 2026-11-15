const store = require('./store.mjs');
console.log('SAID legacy runs');
exports.write = () => store.write();
exports.raw = store;
