type Point = { x: number; y: number; label: string };
type Step = { at: Point; note: string; next: Step | null };
function move(from: Point, by: number, note: string, next: Step | null): Step {
  return { at: { ...from, x: from.x + by }, note, next };
}
let chain: Step | null = null;
let at: Point = { x: 0, y: 7, label: "start" };
const before: Point[] = [];
for (let round = 0; round < 2000; round++) {
  before.push({ x: round, y: -round, label: "before " + round });
  chain = move(at, round % 5, "round " + round, round % 64 === 0 ? null : chain);
  at = chain.at;
}
let sum = 0;
let wrong = 0;
for (let index = 0; index < before.length; index++) {
  const point = before[index];
  if (point.x !== index || point.y !== -index || point.label !== "before " + index) wrong++;
  sum += point.x;
}
let length = 0;
for (let step = chain; step !== null; step = step.next) {
  length++;
  if (typeof step.at.x !== "number" || step.at.y !== 7 || step.at.label !== "start" || !step.note.startsWith("round ")) wrong++;
}
console.log(sum, wrong, length, JSON.stringify(at));
