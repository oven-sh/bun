class Coin { cents = 1; tens = 2; name = "coin"; }
class Till { taken = 0; take(coin: Coin): void { if (coin.cents === undefined) this.taken++; if (coin.tens === undefined) this.taken++; if (coin.name === undefined) this.taken++; } }
const made = new Coin();
const tills = [new Till(), new Till()];
const list: Coin[] = JSON.parse("[" + Array.from({ length: 1000 }, (_, i) => i % 10 ? "{\"cents\":7}" : "7").join() + "]");
for (let round = 0; round < 1000; round++) { for (let i = 0; i < list.length; i++) tills[i & 1].take(list[i]); }
console.log(tills[0].taken + tills[1].taken + made.cents - 1);
