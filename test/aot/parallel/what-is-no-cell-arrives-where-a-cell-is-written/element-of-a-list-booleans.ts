class Coin { cents = 1; }
const made = new Coin();
const list: Coin[] = JSON.parse("[" + Array(1000).fill("true").join() + "]");
let seen = made.cents - 1;
for (let round = 0; round < 1000; round++) { for (let i = 0; i < list.length; i++) { if (list[i].cents === undefined) seen++; } }
console.log(seen);
