type Tally = { tries: number; busy: number; plain: boolean };
type Answer = { tally: Tally; verdict: string };
function decide(tally: Tally, most: number, kind: string): Answer {
  if (kind === "busy") return { tally: { ...tally, busy: tally.busy + 1 }, verdict: tally.busy < most ? "again" : "fail" };
  if (kind === "tries") return { tally: { ...tally, tries: tally.tries + 1 }, verdict: tally.tries < most ? "again" : "fail" };
  return { tally, verdict: "fail" };
}
let tally: Tally = { tries: 0, busy: 0, plain: false };
const kept: Answer[] = [];
const kinds = ["tries", "busy", "none", "tries", "tries", "busy", "tries"];
for (const kind of kinds) {
  const answer = decide(tally, 3, kind);
  kept.push(answer);
  tally = answer.tally;
  console.log(kind, answer.verdict, JSON.stringify(tally));
}
console.log(JSON.stringify(kept));
console.log(kept.every((answer, index) => index + 1 === kept.length || kinds[index + 1] !== "none" || kept[index + 1].tally === answer.tally));
