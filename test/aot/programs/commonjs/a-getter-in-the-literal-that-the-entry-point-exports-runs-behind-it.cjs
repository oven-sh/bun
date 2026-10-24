// See getters-among-the-exports-of-the-entry-point-run-behind-it.cjs: here the getter is written in an object literal, and nothing in the program reads it.
module.exports = {
  plain: 1,
  get computed() {
    console.log("computed is read");
    return this.plain + 1;
  },
};
console.log("the last statement");
