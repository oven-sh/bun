class Coin { cents = 1; }
const made = new Coin();
function centsOf(coin: Coin): number { return coin.cents; }
const list: Coin[] = JSON.parse("[" + Array.from({ length: 1000 }, (_, i) => i % 10 ? "{\"cents\":7}" : "7").join() + "]");
let seen = made.cents - 1;
for (let round = 0; round < 1000; round++) { for (let i = 0; i < list.length; i++) { if (centsOf(list[i]) === undefined) seen++; } }
console.log(seen);
