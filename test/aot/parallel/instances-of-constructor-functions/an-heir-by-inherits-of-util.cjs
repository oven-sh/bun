const turns = +process.argv[2] || 40;
function Coin(face, worth) { this.face = face; this.worth = worth; }
function Note(face, worth) { this.face = face; this.worth = worth; this.folds = 0; }
function worthOf(thing) { return thing.worth + (thing instanceof Coin ? 1 : 0) + (thing instanceof Note ? thing.folds : 0); }
function tally(things) { let sum = 0; for (let i = 0; i < things.length; i++) sum += worthOf(things[i]); return sum; }
const util = require('util');
function Ducat(face) { Coin.call(this, face, 30); this.gold = true; }
util.inherits(Ducat, Coin);
let sum = 0; for (let t = 0; t < turns; t++) sum += tally([new Ducat(t), new Coin(t, 1), new Ducat(t + 1)]);
console.log(sum, new Ducat(1) instanceof Coin);
