module.exports = (condition, message) => {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
};

module.exports.strictEqual = (a, b, msg) => {
  if (a !== b) throw new Error(msg || `${a} !== ${b}`);
};

module.exports.ok = module.exports;
