const registry = require("./registry.cjs");
registry.add("names", () => {
  const m = require("./m.cjs");
  return m.early + ":" + m.late;
});
registry.add("object", () => Object.keys(require("./m.cjs")).join() + ":" + require("./m.cjs").late);
