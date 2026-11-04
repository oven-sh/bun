let last: number[] = [];
function step(...turn: number[]): number {
  const n = turn[0];
  const acc = turn[2];
  if (n === 0) return acc + (turn[1] === undefined ? 0 : 1000) + turn.length;
  const list: number[] = new Array<number>(3);
  list[0] = n - 1;
  list[2] = acc + 1;
  last = list;
  return step.apply(null, list);
}
let answer: string;
try { answer = String(step(1000000, 0, 0)); } catch (error) { answer = (error as Error).constructor.name; }
console.log(answer, last.length, 1 in last);
