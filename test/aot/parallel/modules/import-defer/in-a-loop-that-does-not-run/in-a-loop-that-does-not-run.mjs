import defer * as a from "./a.mjs";
console.log("main begins");
for (let i = 0; i < process.argv.length - 99; i++) console.log(a.value);
console.log("main ends");
