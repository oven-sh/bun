import defer * as a from "./a.mjs";
console.log("main begins");
console.log(a.bump((console.log("the argument is evaluated"), 1)));
