// Requires a graph of which m5.cjs was already requested by the graph around it.
try {
  globalThis.answer = require("./m2.mjs").t2;
} catch (error) {
  globalThis.answer = `caught ${error.message.replace(/".*\//, "")}`;
}
