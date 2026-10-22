const base = { a: 1 };
module.exports = { ...base, b: 2, ["c" + 1]: 3, get d() { return 4; } };
