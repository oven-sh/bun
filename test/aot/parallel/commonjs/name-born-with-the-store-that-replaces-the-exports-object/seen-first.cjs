exports.early = 1;
const kept = exports;
const now = module.exports = { late: 2 };
now.early = kept.early;
