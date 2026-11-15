class Coin { constructor(worth) { this.worth = worth; } value(rate) { return this.worth * rate; } }
class Note { constructor(worth) { this.worth = worth; this.folds = 1; } value(rate) { return this.worth * rate - this.folds; } }
const worths = JSON.parse("[1,2,5,10,20,50]");
const purse = [];
for (const worth of worths) purse.push(worth < 10 ? new Coin(worth) : new Note(worth));
function sum(things, rate) { let all = 0; for (const thing of things) all += thing.value(rate); return all; }
console.log(sum(purse, 1), sum(purse, 1.5), sum(purse.slice(0, 3), 2), sum(purse.slice(3), 2));
