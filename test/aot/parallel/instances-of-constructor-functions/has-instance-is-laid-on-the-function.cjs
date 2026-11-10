const turns = +process.argv[2] || 40;
function Coin(face, worth) { this.face = face; this.worth = worth; }
function Note(face, worth) { this.face = face; this.worth = worth; this.folds = 0; }
function worthOf(thing) { return thing.worth + (thing instanceof Coin ? 1 : 0) + (thing instanceof Note ? thing.folds : 0); }
function tally(things) { let sum = 0; for (let i = 0; i < things.length; i++) sum += worthOf(things[i]); return sum; }
const name = process.argv[3] || 'hasInstance';
let sum = 0; for (let t = 0; t < turns; t++) { if (t === turns >> 1) Object.defineProperty(Coin, Symbol[name], { value: function (x) { return x && x.worth === 5; }, configurable: true }); sum += tally([new Coin(t, 1), new Note(t, 5)]); }
console.log(sum);
