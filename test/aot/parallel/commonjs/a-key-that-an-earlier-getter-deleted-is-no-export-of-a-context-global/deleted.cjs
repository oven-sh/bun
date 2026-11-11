const sandbox = {
  get first() {
    delete sandbox.second;
    return 1;
  },
  second: 2,
};
module.exports = require("node:vm").runInNewContext("this", sandbox);
