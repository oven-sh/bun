const vm = require("node:vm");
function Point(x) { this.x = x; }
Point.prototype.name = function () { return "here"; };
const there = vm.runInNewContext("(function (F) { F.prototype = { name() { return 'there'; } }; })");
function run(n) { const out = []; for (let i = 0; i < n; i++) { if (i === 2) there(Point); out.push(new Point(i).name()); } return out.join(" "); }
console.log(run(4));
