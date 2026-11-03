import defer * as a from "./a.mjs";
console.log("main begins");
console.log(Reflect.set(a, "value", 5));
console.log("main ends");
