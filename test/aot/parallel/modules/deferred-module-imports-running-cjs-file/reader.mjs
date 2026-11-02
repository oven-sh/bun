import defer * as deferred from "./hands-on.mjs";
console.log("reader begins");
const { early } = deferred;
console.log("reader got", JSON.stringify(early));
