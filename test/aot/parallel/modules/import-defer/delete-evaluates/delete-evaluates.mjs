import defer * as a from "./a.mjs";
console.log("main begins");
console.log(Reflect.deleteProperty(a, "missing"), Reflect.deleteProperty(a, "value"));
