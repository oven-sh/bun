const turns = +process.argv[2] || 40;
function Coin(face, worth) { this.face = face; this.worth = worth; }
function Note(face, worth) { this.face = face; this.worth = worth; this.folds = 0; }
function worthOf(thing) { return thing.worth + (thing instanceof Coin ? 1 : 0) + (thing instanceof Note ? thing.folds : 0); }
function tally(things) { let sum = 0; for (let i = 0; i < things.length; i++) sum += worthOf(things[i]); return sum; }
const Penny = Coin.bind(null, 'p'); const Odd = Coin.bind({ ignored: true });
let sum = 0; for (let t = 0; t < turns; t++) { const a = new Penny(t), b = new Odd(t, 3); sum += tally([a, b]) + (a instanceof Penny ? 10 : 0) + (a.face === 'p' ? 1 : 0); }
console.log(sum);
