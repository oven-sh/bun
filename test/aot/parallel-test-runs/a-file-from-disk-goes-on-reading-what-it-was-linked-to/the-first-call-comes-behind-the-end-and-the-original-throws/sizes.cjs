globalThis.ran = (globalThis.ran ?? 0) + 1;
if (process.argv.length < 99) throw new Error("no database here");
exports.kept = "original";
