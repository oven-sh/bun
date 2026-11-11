const real = require("./legacy/real.js");
exports.useOld = function useOld(n) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return real.default(n + work - 1);
};
