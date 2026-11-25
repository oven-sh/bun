const turns = +process.argv[2] || 40;
function Coin(face, worth) { this.face = face; this.worth = worth; }
function Note(face, worth) { this.face = face; this.worth = worth; this.folds = 0; }
function worthOf(thing) { return thing.worth + (thing instanceof Coin ? 1 : 0) + (thing instanceof Note ? thing.folds : 0); }
function tally(things) { let sum = 0; for (let i = 0; i < things.length; i++) sum += worthOf(things[i]); return sum; }
const name = process.argv[3] || 'prototype'; const kept = [];
let sum = 0; for (let t = 0; t < turns; t++) { if (t === turns >> 1) Coin[name] = { bonus: 7 }; const coin = new Coin(t, 1); kept.push(coin); sum += worthOf(coin) + (coin.bonus || 0) + worthOf(kept[0]); }
console.log(sum, kept[0] instanceof Coin, kept[kept.length - 1] instanceof Coin);
