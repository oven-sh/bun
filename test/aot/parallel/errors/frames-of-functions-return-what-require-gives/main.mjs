// Prints which of the functions named k_.. the stack trace lists of an error that a module throws while it loads, for functions that end by returning what `require` gives.
const listNames = error =>
  String(error.stack)
    .split("\n")
    .map(line => /(k_[a-zA-Z]+)/.exec(line))
    .filter(Boolean)
    .map(match => match[1])
    .join(" ");
function k_show(label, load) {
  try {
    console.log(label + ":", load());
  } catch (error) {
    console.log(label + ":", error.constructor.name, "|", listNames(error));
  }
}
for (let turn = 0; turn < 2; turn++) {
  k_show("held by a variable", function k_held() {
    const loaded = require("./throws-held.cjs");
    return loaded;
  });
  k_show("returned", function k_returned() {
    return require("./throws-returned.cjs");
  });
  k_show("a path held by a variable", function k_resolved() {
    const path = require.resolve("./none.cjs");
    return path;
  });
  k_show("a path returned", function k_returnedPath() {
    return require.resolve("./none.cjs");
  });
  k_show("held by a variable that is used twice", function k_kept() {
    const loaded = require("./throws-kept.cjs");
    k_show(loaded);
    return loaded;
  });
}
