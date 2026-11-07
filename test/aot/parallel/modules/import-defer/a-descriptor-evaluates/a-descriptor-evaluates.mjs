import defer * as a from "./a.mjs";
console.log("main begins");
console.log(JSON.stringify(Object.getOwnPropertyDescriptor(a, "value")));
