import { test } from "bun:test";
const realJoin = Array.prototype.join; Array.prototype.join = function () { return 42; };
const listText = [1, 2].toString();
Array.prototype.join = realJoin;
const realExec = RegExp.prototype.exec; RegExp.prototype.exec = function () { return { index: "seven", 0: "z", length: 1 }; };
const matched = "abc".match(/b/); const found = "abc".search(/b/);
RegExp.prototype.exec = realExec;
test("what the rows answer", () => { console.log(typeof listText, listText === 42, Array.isArray(matched), matched && matched.index, typeof found, found === "seven"); });
