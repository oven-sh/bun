console.log("lib loaded");
// The name that the module exports is decided when it runs, and is not `holder`.
const key = process.argv.length > 100 ? "holder" : "other";
module.exports[key] = 1;
