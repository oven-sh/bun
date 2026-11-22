// A loop asks a field of one object in some of its turns alone, and one side of the question calls.
// STATISTIC: BranchesUnswitched >= 1
interface Kettle { state: "cold" | "warm" | "boiling"; liters: number }
function pour(kettle: Kettle, cups: number[], count: number): number {
  let filled = 0;
  for (let i = 0; i < count; i++) {
    if (cups[i] > 1) {
      if (kettle.state !== "boiling") filled += 0;
      else console.log("steam", i);
    }
    if (cups[i] > 1) filled++;
  }
  return filled;
}
const spare: Kettle = { state: "cold", liters: 1 };
const kettle: Kettle = { state: "warm", liters: 2 };
Object.defineProperty(kettle, "state", { enumerable: false });
console.log(pour(kettle, [1, 2, 3, 4, 5, 6, 7, 8], 8), Object.keys(kettle).join(), Object.keys(spare).join());
kettle.state = "boiling";
console.log(pour(kettle, [1, 2, 3], 3), JSON.stringify(kettle));
