// The prototype of Heir is an instance of Base, and the method laid on it behind many calls is a function of another realm.
"use strict";
const vm = require("node:vm");
function Base(a) { this.a = a; }
Base.prototype.area = function () { return this.a + 1; };
function Heir(a) { this.a = a; this.b = 2; }
Heir.prototype = new Base(0);
Heir.prototype.constructor = Heir;
Heir.prototype.area = function () { return this.a + this.b; };
const turns = Number(process.argv[2] ?? 2000);
const foreign = vm.runInNewContext("(function () { return 7000 + this.a; })");
const keys = JSON.parse(`["area"]`);
function run(name) {
  let sum = 0;
  for (let i = 0; i < turns; i++) sum = (sum + new Heir(i & 7).area()) | 0;
  console.log(name, sum);
}
run("as written");
Heir.prototype[keys[0]] = foreign;
run("a function of another realm");
