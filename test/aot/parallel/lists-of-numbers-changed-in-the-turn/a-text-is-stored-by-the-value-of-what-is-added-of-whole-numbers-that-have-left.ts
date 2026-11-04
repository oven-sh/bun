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
let turn = 0;
let held: any;
const added: any = { valueOf() {
  const it = held, at = turn;
  if (at === 2) { it[at] = "text"; }
  return 0;
} };
function make(): number[] {
  const list: number[] = [];
  for (let i = 0; i < 6; i++) list.push(i + 1);
  (globalThis as any).keptOutside = list;
  return list;
}
function work(list: number[], second: number[]): number {
  let sum = 0;
  for (let i = 0; i < list.length && i < 9; i++) {
    turn = i;
    held = list;
    list[i] = list[i] * 2 + added;
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
