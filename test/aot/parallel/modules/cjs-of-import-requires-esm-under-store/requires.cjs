see("requires");
store.run("require", () => {
  require("./requires-shared.mjs");
  see("behind require()");
});
see("end of requires");
module.exports = {};
