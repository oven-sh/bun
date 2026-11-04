class Coin { cents = 1; }
const made = new Coin();
class Purse { coin: Coin; constructor(coin: Coin) { this.coin = coin; } }
const purses: Purse[] = (JSON.parse("[" + Array.from({ length: 1000 }, (_, i) => i % 10 ? "{\"cents\":7}" : "7").join() + "]") as Coin[]).map(coin => new Purse(coin));
let seen = made.cents - 1;
for (let round = 0; round < 1000; round++) { for (let i = 0; i < purses.length; i++) { if (purses[i].coin.cents === undefined) seen++; } }
console.log(seen);
