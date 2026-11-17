const turns = +process.argv[2] || 40;
function Coin(face, worth) { this.face = face; this.worth = worth; }
function Note(face, worth) { this.face = face; this.worth = worth; this.folds = 0; }
function worthOf(thing) { return thing.worth + (thing instanceof Coin ? 1 : 0) + (thing instanceof Note ? thing.folds : 0); }
function tally(things) { let sum = 0; for (let i = 0; i < things.length; i++) sum += worthOf(things[i]); return sum; }
let sum = 0; for (let t = 0; t < turns; t++) { const coin = new Coin(t, 1), note = new Note(t, 5); coin.shiny = t; if (t & 1) delete coin.worth; if (t % 3 === 0) delete note.folds; const a = worthOf(coin), b = worthOf(note); sum += (a === a ? a : 1000) + (b === b ? b : 2000) + Object.keys(coin).length; }
console.log(sum);
