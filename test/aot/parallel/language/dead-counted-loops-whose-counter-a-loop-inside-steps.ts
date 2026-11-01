// A counted loop whose results are unused is removed also where a loop inside steps its counter the same way. Where that loop counts back, or is the only one to count, the loop may turn for ever and is kept.
// IR= 0 countsOn LoopHint
// IR= 2 countsBack LoopHint
// IR= 2 onlyInsideCounts LoopHint
type Point = { x: number; sum: number };
export function countsOn(i: number, n: number, m: number): number {
  let sum = 0;
  for (let k = 0; k < (n | 0); k++) {
    while (k < (m | 0)) k++;
    sum += k;
  }
  const p: Point = { x: i, sum };
  return p.x;
}
export function countsBack(i: number, n: number, m: number): number {
  let sum = 0;
  for (let k = 0; k < (n | 0); k++) {
    while (k > (m | 0)) k--;
    sum += k;
  }
  const p: Point = { x: i + 1, sum };
  return p.x;
}
export function onlyInsideCounts(i: number, n: number, m: number): number {
  let sum = 0;
  for (let k = 0; k < (n | 0); ) {
    while (k < (m | 0)) k++;
    sum += k;
  }
  const p: Point = { x: i + 2, sum };
  return p.x;
}
// What the build cannot know: a number that is read from a text.
const read = (text: string): number => Number(text);
console.log(countsOn(1, read("9"), read("4")), countsBack(2, read("9"), read("100")), onlyInsideCounts(3, read("9"), read("20")));
