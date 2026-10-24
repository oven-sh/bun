type Tally = { tries: number; text: string; list: number[] };
type Answer = { tally: Tally; verdict: string };
function decide(tally: Tally, round: number): Answer {
  return { tally: { ...tally, tries: tally.tries + 1 }, verdict: "round " + round };
}
let tally: Tally = { tries: 0, text: "kept", list: [1, 2, 3] };
let last: Answer | null = null;
for (let round = 0; round < 300000; round++) {
  last = decide(tally, round);
  tally = last.tally;
  if (round % 50000 === 0) Bun.gc(true);
}
console.log(JSON.stringify(tally), last!.verdict, last!.tally === tally);
