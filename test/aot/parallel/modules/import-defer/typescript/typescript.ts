import defer * as a from "./a.mjs";
console.log("main begins");
const value: number = a.value;
console.log(value, a.bump());
