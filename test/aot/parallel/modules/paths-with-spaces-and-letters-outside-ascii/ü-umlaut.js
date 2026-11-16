globalThis.runs.umlaut = (globalThis.runs.umlaut ?? 0) + 1;
exports.file = __filename;
exports.folder = __dirname;
exports.fail = function failInUmlaut() {
  throw new Error("thrown in ü-umlaut.js");
};
