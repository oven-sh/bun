const turns = +process.argv[2] || 40;
function Coin(face, worth) { this.face = face; this.worth = worth; }
function Note(face, worth) { this.face = face; this.worth = worth; this.folds = 0; }
function worthOf(thing) { return thing.worth + (thing instanceof Coin ? 1 : 0) + (thing instanceof Note ? thing.folds : 0); }
function tally(things) { let sum = 0; for (let i = 0; i < things.length; i++) sum += worthOf(things[i]); return sum; }
function Token(face, worth) { this.face = face; this.worth = worth; if (worth & 1) return { face: face, worth: worth * 10, odd: true }; }
function read(thing) { return thing.worth + (thing instanceof Token ? 1 : 0) + (thing.odd ? 100 : 0); }
let sum = 0; for (let t = 0; t < turns; t++) sum += read(new Token(t, t));
console.log(sum);
