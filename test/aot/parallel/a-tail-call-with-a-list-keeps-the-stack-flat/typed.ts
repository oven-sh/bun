type Turn = [number, number | undefined, number];
let last: Turn | null = null;
function step(n: number, hole: number | undefined, acc: number): number {
  if (n === 0) return acc + (hole === undefined ? 0 : 1000);
  const list = [n - 1, , acc + 1] as Turn;
  last = list;
  return step.apply(null, list);
}
let answer: string;
try { answer = String(step(1000000, undefined, 0)); } catch (error) { answer = (error as Error).constructor.name; }
console.log(answer, last!.length);
