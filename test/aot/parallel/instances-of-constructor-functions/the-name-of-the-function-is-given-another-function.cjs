const turns = +process.argv[2] || 40;
function Coin(face, worth) { this.face = face; this.worth = worth; }
function Note(face, worth) { this.face = face; this.worth = worth; this.folds = 0; }
function worthOf(thing) { return thing.worth + (thing instanceof Coin ? 1 : 0) + (thing instanceof Note ? thing.folds : 0); }
function tally(things) { let sum = 0; for (let i = 0; i < things.length; i++) sum += worthOf(things[i]); return sum; }
var Chip = function (worth) { this.worth = worth; };
function read(thing) { return thing.worth + (thing instanceof Chip ? 1 : 0); }
let sum = 0; for (let t = 0; t < turns; t++) { if (t === turns >> 1) Chip = function (worth) { this.worth = worth * 100; this.late = true; }; sum += read(new Chip(t)); }
console.log(sum);
