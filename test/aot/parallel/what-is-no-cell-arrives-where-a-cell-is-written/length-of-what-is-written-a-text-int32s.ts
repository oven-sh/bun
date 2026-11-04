function lengthOf(text: string): number { return text.length; }
const made = { cents: lengthOf("a") };
const list: string[] = JSON.parse("[" + Array(1000).fill("7").join() + "]");
let seen = made.cents - 1;
for (let round = 0; round < 1000; round++) { for (let i = 0; i < list.length; i++) { if (lengthOf(list[i]) === undefined) seen++; } }
console.log(seen);
