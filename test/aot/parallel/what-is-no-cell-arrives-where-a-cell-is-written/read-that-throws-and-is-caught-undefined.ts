class Coin { cents = 1; }
const made = new Coin();
const list: Coin[] = Array(1000).fill(undefined);
let seen = made.cents - 1;
for (let round = 0; round < 100; round++) { for (let i = 0; i < list.length; i++) { try { if (list[i].cents === undefined) seen++; } catch { seen += 2; } } }
console.log(seen);
