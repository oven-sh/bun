const attempt = run => {
  try {
    return run();
  } catch (error) {
    return "throws " + error.constructor.name;
  }
};
const results = [];
results.push("evaluated " + attempt(() => Object.keys(require("./cycle-a.mjs")).join()));
results.push("asynchronous " + attempt(() => Object.keys(require("./awaits-when-required.mjs")).join()));
results.push("failed " + attempt(() => Object.keys(require("./fails-a.mjs")).join()));
const first = require("./counted.cjs");
results.push("cached " + (require("./counted.cjs") === first));
module.exports = results;
