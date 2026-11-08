// The loop of a generator is walked with the turn of its consumer inside it: a variable of the module that the generator steps leaves the integers of 32 bits late and the consumer carries a sum and a count round.
let seen: number = JSON.parse("2147483640");
function* up(n: number): Generator<number> { for (let i = 0; i < n; i++) { seen++; yield i; } }
function go(most: number): string { let s = 0, n = 0; for (const x of up(most)) { s += x as number; n++; } return s + " " + n; }
for (let run = 0; run < 4; run++) console.log(go(5), seen);
export {};
