const turns = +process.argv[2] || 40;
function Coin(face, worth) { this.face = face; this.worth = worth; }
function Note(face, worth) { this.face = face; this.worth = worth; this.folds = 0; }
function worthOf(thing) { return thing.worth + (thing instanceof Coin ? 1 : 0) + (thing instanceof Note ? thing.folds : 0); }
function tally(things) { let sum = 0; for (let i = 0; i < things.length; i++) sum += worthOf(things[i]); return sum; }
const bag = { face: 0, worth: 0 };
let sum = 0; for (let t = 0; t < turns; t++) { Coin.call(bag, t, t * 2); sum += worthOf(bag) + worthOf(new Coin(t, 1)); const made = Coin.apply({ extra: 1 }, [t, 3]); sum += made === undefined ? 1 : 1000; }
console.log(sum, Object.keys(bag).join());
