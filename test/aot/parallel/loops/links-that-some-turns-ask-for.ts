// A loop asks in some of its turns alone whether an object leads to another one, and one side of the question calls.
// STATISTIC: BranchesUnswitched >= 1
interface Stop { next: Stop | null; seats: number }
function ask(stop: Stop, place: number): void {
  if (!stop.next) return;
  console.log("goes on", place);
}
interface Line { stop: Stop; name: string }
function ride(line: Line, riders: number[]): number {
  let total = 0;
  for (let i = 0; i < 8; i++) {
    if (riders[i] > 1) ask(line.stop, i);
    total += riders[i];
  }
  return total;
}
const first: Stop = { next: null, seats: 1 };
const last: Stop = { next: null, seats: 2 };
Object.defineProperty(last, "next", { enumerable: false });
console.log(ride({ stop: last, name: "north" }, [1, 2, 3, 4, 5, 6, 7, 8]), Object.keys(first).join(), Object.keys(last).join());
