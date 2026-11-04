class Coin { cents = 1; tens = 2; name = "coin"; }
const made = new Coin();
function worth(coin: Coin, depth: number): number { if (depth > 0) return worth(coin, depth - 1); return (coin.cents === undefined ? 1 : 0) + (coin.tens === undefined ? 1 : 0) + (coin.name === undefined ? 1 : 0); }
const list: Coin[] = JSON.parse("[" + Array(1000).fill("7").join() + "]");
let seen = made.cents - 1;
for (let round = 0; round < 1000; round++) { for (let i = 0; i < list.length; i++) seen += worth(list[i], 1); }
console.log(seen);
