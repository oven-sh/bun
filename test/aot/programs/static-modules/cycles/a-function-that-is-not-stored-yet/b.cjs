const a = require("./a.cjs");
const attempt = action => {
  try {
    return action();
  } catch (error) {
    return error.constructor.name;
  }
};
exports.attempts = [attempt(() => a.declared()), attempt(() => a.arrow()), attempt(() => new a.Class()), attempt(() => a.arrow?.()), typeof a.declared].join();
exports.later = () => [a.declared(), a.arrow(), new a.Class().kind()].join();
