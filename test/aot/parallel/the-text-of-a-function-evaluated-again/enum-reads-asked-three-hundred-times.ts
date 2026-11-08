// The text is asked for, evaluated and called three hundred times.
enum Step { Small = 1, Large = 10 }
function stride(count: number) { return count * Step.Large + Step.Small; }
let total = 0;
for (let round = 0; round < 300; round++) total += (0, eval)("(" + String(stride) + ")")(round) - stride(round) + 1;
console.log(total);
