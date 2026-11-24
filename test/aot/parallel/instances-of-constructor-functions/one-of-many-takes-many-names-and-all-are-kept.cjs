const turns = +process.argv[2] || 40;
function Coin(face, worth) { this.face = face; this.worth = worth; }
function Note(face, worth) { this.face = face; this.worth = worth; this.folds = 0; }
function worthOf(thing) { return thing.worth + (thing instanceof Coin ? 1 : 0) + (thing instanceof Note ? thing.folds : 0); }
function tally(things) { let sum = 0; for (let i = 0; i < things.length; i++) sum += worthOf(things[i]); return sum; }
const kept = [];
function mark(thing, tags) { const base = thing.face + thing.worth; if (tags) { thing.n0 = base; thing.n1 = base; thing.n2 = base; thing.n3 = base; thing.n4 = base; thing.n5 = base; thing.n6 = base; thing.n7 = base; thing.n8 = base; thing.n9 = base; thing.n10 = base; thing.n11 = base; thing.n12 = base; thing.n13 = base; thing.n14 = base; thing.n15 = base; thing.n16 = base; thing.n17 = base; thing.n18 = base; thing.n19 = base; thing.n20 = base; thing.n21 = base; thing.n22 = base; thing.n23 = base; thing.n24 = base; thing.n25 = base; thing.n26 = base; thing.n27 = base; thing.n28 = base; thing.n29 = base; thing.n30 = base; thing.n31 = base; thing.n32 = base; thing.n33 = base; thing.n34 = base; thing.n35 = base; thing.n36 = base; thing.n37 = base; thing.n38 = base; thing.n39 = base; } return base; }
let sum = 0; for (let t = 0; t < turns * 50; t++) { const coin = new Coin(t, 1); kept.push(coin); sum += mark(coin, t === 0); }
console.log(sum, kept.length, Object.keys(kept[0]).length, Object.keys(kept[1]).length);
