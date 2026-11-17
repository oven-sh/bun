const turns = +process.argv[2] || 40;
function Coin(face, worth) { this.face = face; this.worth = worth; }
function Note(face, worth) { this.face = face; this.worth = worth; this.folds = 0; }
function worthOf(thing) { return thing.worth + (thing instanceof Coin ? 1 : 0) + (thing instanceof Note ? thing.folds : 0); }
function tally(things) { let sum = 0; for (let i = 0; i < things.length; i++) sum += worthOf(things[i]); return sum; }
let sum = 0; for (let t = 0; t < turns; t++) { const plain = { face: t, worth: 6 }; const note = new Note(t, 5); if (t & 1) { Object.setPrototypeOf(plain, Coin.prototype); Object.setPrototypeOf(note, Coin.prototype); } sum += tally([plain, note, new Coin(t, 1)]); }
console.log(sum);
