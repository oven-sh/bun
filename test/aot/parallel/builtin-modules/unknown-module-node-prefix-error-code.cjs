// `require("node:<no such module>")` fails with ERR_UNKNOWN_BUILTIN_MODULE, not with the code of a file that was not found.
try {
  require("node:no-such-module");
} catch (error) {
  console.log("written:", error.code);
}
try {
  require("node:é");
} catch (error) {
  console.log("written, not ASCII:", error.code);
}
for (const name of ["node:no-such-module", "node:é", ["node:", "nothing"].join("")]) {
  try {
    require(name);
    console.log(name, "was loaded");
  } catch (error) {
    console.log(JSON.stringify(name), error.code);
  }
}
