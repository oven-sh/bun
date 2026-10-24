try {
  exports.seen = Object.keys(require("./main.mjs")).join();
} catch (error) {
  exports.seen = "threw " + error.constructor.name;
}
