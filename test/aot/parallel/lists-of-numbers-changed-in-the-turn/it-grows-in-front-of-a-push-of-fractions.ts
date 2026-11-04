// Made by test/aot/tools/generate-lists-of-numbers-changed-in-the-turn.py.
const one: number = +process.argv[2] || 1;
function show(x: unknown): string {
  return Object.is(x, -0) ? "-0" : typeof x === "string" ? JSON.stringify(x) : String(x);
}
function describe(list: any): string {
  let text = list.length + " [";
  for (const key of Object.keys(list).slice(0, 12)) text += " " + key + "=" + show(list[key]);
  return text + " ]";
}
function change(it: any, at: number): number {
  if (at === 2) { it.push(9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9); }
  return 0;
}
function make(): number[] {
  const list: number[] = [];
  for (let i = 0; i < 6; i++) list.push(i + one / 2);
  return list;
}
function work(list: number[], second: number[]): number {
  let sum = 0;
  for (let i = 0; i < list.length && i < 9; i++) {
    change(list, i);
    if (i < 4) list.push(i + one / 4);
  }
  return sum;
}
for (let round = 0; round < 2; round++) {
  const list = make();
  try {
    console.log(show(work(list, list)));
  } catch (error: any) {
    console.log("thrown: " + error.name);
  }
  console.log(describe(list));
}
