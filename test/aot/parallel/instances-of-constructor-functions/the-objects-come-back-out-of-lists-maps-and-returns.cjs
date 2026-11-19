const turns = +process.argv[2] || 40;
function Coin(face, worth) { this.face = face; this.worth = worth; }
function Note(face, worth) { this.face = face; this.worth = worth; this.folds = 0; }
function worthOf(thing) { return thing.worth + (thing instanceof Coin ? 1 : 0) + (thing instanceof Note ? thing.folds : 0); }
function tally(things) { let sum = 0; for (let i = 0; i < things.length; i++) sum += worthOf(things[i]); return sum; }
function mint(t) { return t & 1 ? new Coin(t, 1) : new Note(t, 5); }
const purse = new Map();
let sum = 0; for (let t = 0; t < turns; t++) { purse.set(t & 3, mint(t)); const [first, ...rest] = [mint(t), mint(t + 1), mint(t + 2)]; sum += worthOf(first) + tally(rest) + tally([...purse.values()]) + worthOf({ held: mint(t) }.held); }
console.log(sum);
