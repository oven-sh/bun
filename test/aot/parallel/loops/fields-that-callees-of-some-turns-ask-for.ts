// A loop calls in some of its turns alone what asks a field of one object first. The field holds what was parsed.
// STATISTIC: BranchesUnswitched >= 1
interface Signal { color: "red" | "amber" | "green"; number: number }
let rung = 0;
let bell = (value: number) => { rung += value; console.log("ring", value); };
function watch(signal: Signal, place: number): void {
  if (signal.color !== "amber") return;
  bell(place);
}
class Crossing {
  number: number;
  color: "red" | "amber" | "green";
  constructor(color: "red" | "amber" | "green", number: number) { this.color = color; this.number = number; }
  pass(wagons: number[]): number {
    let weight = 0;
    for (let i = 0; i < 8; i++) {
      if (wagons[i] > 1) watch(this, i);
      weight += wagons[i];
    }
    return weight;
  }
}
const open = new Crossing("green", 1);
const parsed = new Crossing(JSON.parse("7"), 2);
let sum = 0;
for (const crossing of [open, parsed, open]) sum += crossing.pass([1, 2, 3, 4, 5, 6, 7, 8]);
console.log(sum, rung, typeof parsed.color, JSON.stringify(parsed));
