class Coin { cents = 1; }
const made = new Coin();
class Purse { coin: Coin; constructor(coin: Coin) { this.coin = coin; } }
const purses: Purse[] = (JSON.parse("[" + Array(1000).fill("7.5").join() + "]") as Coin[]).map(coin => new Purse(coin));
let seen = made.cents - 1;
for (let round = 0; round < 1000; round++) { for (let i = 0; i < purses.length; i++) { if (purses[i].coin.cents === undefined) seen++; } }
console.log(seen);
