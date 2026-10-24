const main = require("./main.mjs");
const attempt = read => {
  try {
    return read();
  } catch (error) {
    return error.constructor.name;
  }
};
exports.seen = attempt(() => Object.keys(main).length) + ":" + attempt(() => main.value);
exports.later = () => attempt(() => Object.keys(main).length) + ":" + attempt(() => main.value);
