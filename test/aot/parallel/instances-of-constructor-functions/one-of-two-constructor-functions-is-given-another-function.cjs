const turns = +process.argv[2] || 40;
function Coin(worth) { this.worth = worth; this.marks = 3; }
var Note = function (worth) { this.worth = worth; this.marks = 4; this.folds = 1; };
function worthOf(thing) { return thing.worth * 10 + thing.marks + (thing instanceof Coin ? 1 : 0) + (thing instanceof Note ? 2 : 0); }
let sum = 0; for (let t = 0; t < turns; t++) { if (t === turns >> 1) Note = function (worth) { this.late = 7; this.marks = 5; this.worth = worth * 100; }; sum += worthOf(new Coin(t)) + worthOf(new Note(t)); }
console.log(sum);
