module.exports = function () { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return require('./late.cjs').name; };
