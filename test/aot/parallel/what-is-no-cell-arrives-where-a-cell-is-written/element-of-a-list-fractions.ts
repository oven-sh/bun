class Coin { cents = 1; }
const made = new Coin();
const list: Coin[] = JSON.parse("[" + Array(1000).fill("7.5").join() + "]");
let seen = made.cents - 1;
for (let round = 0; round < 1000; round++) { for (let i = 0; i < list.length; i++) { if (list[i].cents === undefined) seen++; } }
console.log(seen);
