import { test } from "bun:test";
const real = Date.prototype.toISOString;
Date.prototype.toISOString = function () { return 42; };
const answer = new Date(0).toJSON();
Date.prototype.toISOString = real;
test("what toJSON answers", () => { console.log(typeof answer, answer === 42); });
