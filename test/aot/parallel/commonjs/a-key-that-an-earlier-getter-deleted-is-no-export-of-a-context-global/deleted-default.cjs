const sandbox = {
  __esModule: true,
  get first() {
    delete sandbox.default;
    return 1;
  },
  default: "d",
};
module.exports = require("node:vm").runInNewContext("this", sandbox);
