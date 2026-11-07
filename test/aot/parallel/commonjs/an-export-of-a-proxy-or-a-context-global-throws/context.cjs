module.exports = require("node:vm").runInNewContext("this", {
  before: 1,
  get boom() {
    throw new Error("boom");
  },
  after: 2,
});
