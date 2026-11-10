// STATISTIC: LoopsOverWrittenKeysWhoseTurnsAreWrittenOut >= 2
// STATISTIC: ElementsOfConstantListsReadAsWritten >= 5
class Peg { x = 1; y = 2; z = 3; }
function sum(peg: Peg): number {
  let total = 0;
  for (const side of ["x", "y", "z"] as const) total = total * 10 + peg[side];
  return total;
}
function fill(peg: Peg, from: number): void {
  for (const side of ["z", "x"] as const) peg[side] = from++;
}
const peg = new Peg();
const said: unknown[] = [sum(peg)];
fill(peg, 7);
said.push(sum(peg), peg.x, peg.y, peg.z);
console.log(said.map(String).join(" "));
