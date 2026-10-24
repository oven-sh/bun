const e = require("./e.mjs");
const attempt = read => {
  try {
    return read();
  } catch (error) {
    return error.constructor.name;
  }
};
exports.seen = attempt(() => Object.keys(e).length) + ":" + attempt(() => e.value);
exports.later = () => Object.keys(e).length + ":" + e.value;
