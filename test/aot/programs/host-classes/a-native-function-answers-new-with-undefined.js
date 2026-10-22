const { resolveObjectURL } = require("node:buffer");
const answer = new resolveObjectURL("blob:nodedata:none");
console.log(typeof answer, answer === undefined, answer == null, answer ?? "nothing", typeof answer === "undefined" ? "undefined" : "defined");
