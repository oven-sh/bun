globalThis.whileFileRuns = () => {
  const file = require("./file.cjs");
  console.log("while it runs", Object.prototype.toString.call(file), Object.keys(file).join());
};
