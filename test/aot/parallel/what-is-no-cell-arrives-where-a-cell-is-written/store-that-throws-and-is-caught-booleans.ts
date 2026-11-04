class Coin { cents = 1; }
const made = new Coin();
const list: Coin[] = JSON.parse("[" + Array(1000).fill("true").join() + "]");
let seen = made.cents - 1;
for (let round = 0; round < 100; round++) { for (let i = 0; i < list.length; i++) { try { list[i].cents = 2; seen++; } catch { seen += 2; } } }
console.log(seen);
