"use strict";
class Coin { constructor(n) { this.worth = n; } }
class Leaf { constructor(n) { this.veins = n + "v"; } }
const one = JSON.parse("[1, 2, 3, 4]"), other = JSON.parse("[5, 6, 7]");
const coins = one.filter(n => n > 1), leaves = other.filter(n => n < 7);
coins.length = 0; leaves.length = 0;
for (let i = 0; i < 6; i++) { coins.push(new Coin(i)); leaves.push(new Leaf(i)); }
let worth = 0, veins = "";
for (let turn = 0; turn < 30; turn++) { worth += coins[turn % 6].worth; veins = leaves[turn % 6].veins; }
console.log(worth, veins, coins[0] instanceof Coin, leaves[0] instanceof Leaf);
