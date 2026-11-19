import * as own from "./a-sum-goes-to-a-helper-that-returns-what-a-method-of-the-text-gives.mjs";
export var width = 2;
function cut(text, end) { return text.slice(0, end); }
export function head(text) { return cut(text, width + 1); }
console.log(head("abcd"), Object.keys(own).length);
width = 0.5;
console.log(head("abcd"));
width = "1";
console.log(head("abcdefghijklmnop"));
