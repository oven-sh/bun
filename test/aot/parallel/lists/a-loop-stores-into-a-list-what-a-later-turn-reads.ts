function runningSum(list: number[]): void {
  for (let i = 1; i < list.length; i++) list[i] = list[i]! + list[i - 1]!;
}
function handUp(list: number[]): void {
  for (let i = 0; i + 1 < list.length; i++) list[i + 1] = list[i]! + 1;
}
function handDown(list: number[]): void {
  for (let i = 0; i + 1 < list.length; i++) list[i] = list[i + 1]!;
}
function twoAhead(list: number[]): void {
  for (let i = 0; i + 2 < list.length; i++) list[i + 2] = list[i]! * 2 + list[i + 1]!;
}
function times(list: number[], by: number): void {
  for (let i = 0; i < list.length; i++) list[i] = list[i]! * by;
}
const made: Record<string, (length: number) => number[]> = {
  int32s: length => Array.from({ length }, (_, i) => i + 1),
  fractions: length => Array.from({ length }, (_, i) => i + 0.5),
  boxed: length => { const l = Array.from({ length }, (_, i) => (i & 1 ? i + 0.5 : i)) as unknown[]; l.push("x"); l.pop(); return l as number[]; },
};
const steps: Record<string, (list: number[]) => void> = {
  runningSum,
  handUp,
  handDown,
  twoAhead,
  doubled: list => times(list, 2),
  halved: list => times(list, 0.5),
};
for (const step of Object.keys(steps)) {
  for (const name of Object.keys(made)) {
    for (const length of [0, 1, 2, 3, 4, 5, 7, 8, 9, 13, 16, 17, 33]) {
      const list = made[name]!(length);
      steps[step]!(list);
      console.log(step, name, length, list.join());
    }
  }
}
