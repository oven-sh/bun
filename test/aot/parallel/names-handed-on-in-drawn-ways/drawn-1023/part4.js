export * from "./part1.js";
export let n1 = function () { return "n1@part4 on " + (this === undefined ? "nothing" : Object.keys(this).join("+")); };
