globalThis.runs.japanese = (globalThis.runs.japanese ?? 0) + 1;
module.exports = {
  file: __filename,
  folder: __dirname,
  fail() {
    throw new Error("thrown in 日本語/index.cjs");
  },
};
