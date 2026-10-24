const a = require("./a.mjs");
const attempt = read => {
  try {
    return read();
  } catch (error) {
    return error.constructor.name;
  }
};
exports.seen = [attempt(() => a.hoisted()), attempt(() => a.before), attempt(() => a.later)].join();
exports.readLater = () => a.later;
