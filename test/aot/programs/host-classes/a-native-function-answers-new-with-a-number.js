const { heapSize } = require("bun:jsc");
const answer = new heapSize();
console.log(typeof answer, answer > 0, typeof answer === "number" ? "a number" : "no number", answer === answer + 0, Number.isInteger(answer));
