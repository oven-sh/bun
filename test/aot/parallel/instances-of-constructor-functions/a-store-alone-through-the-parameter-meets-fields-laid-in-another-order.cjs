const turns = +process.argv[2] || 40;
var Chip = function (worth) { this.worth = worth; this.marks = 3; };
function stamp(thing, mark) { thing.marks = mark; return thing instanceof Chip ? 1 : 0; }
let sum = 0; for (let t = 0; t < turns; t++) { if (t === turns >> 1) Chip = function (worth) { this.marks = 5; this.late = 7; this.worth = worth * 100; }; const chip = new Chip(t); sum += stamp(chip, 9) + chip.worth * 10 + chip.marks + (chip.late | 0) * 1000; }
console.log(sum);
