const late = { __esModule: true, default: 1 };
module.exports = late;
setTimeout(() => { late.default = 2; });
