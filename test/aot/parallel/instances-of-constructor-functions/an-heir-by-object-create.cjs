const turns = +process.argv[2] || 40;
function Coin(face, worth) { this.face = face; this.worth = worth; }
function Note(face, worth) { this.face = face; this.worth = worth; this.folds = 0; }
function worthOf(thing) { return thing.worth + (thing instanceof Coin ? 1 : 0) + (thing instanceof Note ? thing.folds : 0); }
function tally(things) { let sum = 0; for (let i = 0; i < things.length; i++) sum += worthOf(things[i]); return sum; }
function Ducat(face) { Coin.call(this, face, 30); this.gold = true; }
Ducat.prototype = Object.create(Coin.prototype); Ducat.prototype.constructor = Ducat;
let sum = 0; for (let t = 0; t < turns; t++) sum += tally([new Coin(t, 1), new Ducat(t), Object.create(Coin.prototype), Object.create(new Coin(t, 4))].map(x => (x.worth === undefined && (x.worth = 2), x)));
console.log(sum);
