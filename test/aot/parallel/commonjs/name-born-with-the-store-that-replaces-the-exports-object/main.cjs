// The store that replaces the exports object stands in what a name is born with, in every spelling that packages use. Whoever can see the object that the body began with still sees it:
// a file that is required while its body runs, `this` and `exports` in front of the store, a second name in front of the first.
const say = (...all) => console.log(all.map(one => (typeof one === "function" ? "function " + one.name : JSON.stringify(one))).join(" | "));
say(require("./literal.cjs"), require("./literal.cjs").a());
say(require("./both-names.cjs"));
say(require("./function.cjs"), require("./function.cjs").extra);
say(require("./second-name.cjs"));
say(require("./seen-first.cjs"));
say(require("./this-first.cjs"));
say(require("./ring-a.cjs"));
say(require("./by-pattern.cjs"));
say(require("./behind-a-return.cjs"));
