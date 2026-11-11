const turns = +process.argv[2] || 40;
var Chip = function (worth) { this.worth = worth; this.marks = 3; };
function read(thing) { return thing.worth * 10 + thing.marks + (thing instanceof Chip ? 1 : 0); }
let sum = 0; for (let t = 0; t < turns; t++) { if (t === turns >> 1) Chip = function (worth) { this.late = 7; this.marks = 5; this.worth = worth * 100; }; sum += read(new Chip(t)); }
console.log(sum);
