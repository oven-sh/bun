const report = e => [e.name, e.code, e.message, e.requireStack && e.requireStack.join()].join(" | ");
exports.computed = name => {
  try {
    return require(name);
  } catch (e) {
    return report(e);
  }
};
exports.literalPackage = () => {
  try {
    return require("no-such-package");
  } catch (e) {
    return report(e);
  }
};
exports.literalFile = () => {
  try {
    return require("./no-such-file.js");
  } catch (e) {
    return report(e);
  }
};
exports.resolve = () => {
  try {
    return require.resolve("no-such-package");
  } catch (e) {
    return report(e);
  }
};
exports.nearby = () => {
  try {
    return require("only-nearby").where;
  } catch (e) {
    return report(e);
  }
};
exports.builtin = () =>
  typeof require("fs").readFileSync + " " + typeof require("node:path").join + " " + typeof require("buffer").Buffer;
