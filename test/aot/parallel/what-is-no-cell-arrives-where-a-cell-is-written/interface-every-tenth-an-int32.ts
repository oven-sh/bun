interface Coin { cents: number; name?: string; }
const made: Coin = { cents: 1 };
function worth(coin: Coin): number { return coin.cents === undefined ? 0 : 1; }
const list = JSON.parse("[" + Array.from({ length: 1000 }, (_, i) => i % 10 ? "{\"cents\":7}" : "7").join() + "]") as Coin[];
let seen = made.cents - 1;
for (let round = 0; round < 1000; round++) { for (const coin of list) seen += worth(coin); }
console.log(seen);
