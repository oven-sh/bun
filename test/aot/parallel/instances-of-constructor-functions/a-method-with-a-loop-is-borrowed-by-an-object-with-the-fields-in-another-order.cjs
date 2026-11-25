const turns = +process.argv[2] || 40;
function Chip(worth) { this.worth = worth; this.marks = 3; }
Chip.prototype.total = function (times) { let sum = 0; for (let i = 0; i < times; i++) sum += this.worth * 10 + this.marks; return sum; };
function Other(worth) { this.late = 7; this.marks = 5; this.worth = worth * 100; }
Other.prototype.total = Chip.prototype.total;
const name = JSON.parse('"total"');
let sum = 0; for (let t = 0; t < turns; t++) sum += new Chip(t)[name](3) + new Other(t)[name](3);
console.log(sum);
