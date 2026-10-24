// A getter that hands on a name of another module is there from its definition on: the module's own body, and a function that it calls, find nothing under the name in front of that.
console.log(require("./a.cjs").x);
console.log(require("./b.cjs").x);
