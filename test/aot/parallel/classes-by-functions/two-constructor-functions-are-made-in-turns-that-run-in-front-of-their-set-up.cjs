// Two constructor functions are made in one turn, and a method of each is called, in a function that a loop calls. The loop runs over two turns in front of the statements that lay the methods: the call of a method that is not there yet throws.
"use strict";
function turn(i) { return new Made(i & 7).area() + new Other(i & 3).area(); }
function run(count) { let sum = 0; for (let i = 0; i < count; i++) sum = (sum + turn(i)) | 0; return sum; }
function attempt(count) { try { return run(count); } catch (error) { return error.constructor.name; } }
const early = attempt(JSON.parse("2"));
function Made(a) { this.a = a; this.b = 2; }
Made.prototype.area = function () { return this.a + this.b; };
function Other(a) { this.a = a; }
Other.prototype.area = function () { return this.a; };
console.log(early, run(Number(process.argv[2] ?? 3000)));
