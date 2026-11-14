const turns = +process.argv[2] || 40;
function Coin(face, worth) { this.face = face; this.worth = worth; }
function Note(face, worth) { this.face = face; this.worth = worth; this.folds = 0; }
function worthOf(thing) { return thing.worth + (thing instanceof Coin ? 1 : 0) + (thing instanceof Note ? thing.folds : 0); }
function tally(things) { let sum = 0; for (let i = 0; i < things.length; i++) sum += worthOf(things[i]); return sum; }
let sum = 0, thrown = 0; for (let t = 0; t < turns; t++) for (const thing of [new Coin(t, 1), { worth: 2 }, 7, 'text', [3], null, undefined, new Proxy(new Coin(t, 4), {}), function () { }, Symbol.iterator]) { try { const got = worthOf(thing); sum += got === got ? got : 13; } catch (error) { thrown += error instanceof TypeError ? 1 : 100; } }
console.log(sum, thrown);
