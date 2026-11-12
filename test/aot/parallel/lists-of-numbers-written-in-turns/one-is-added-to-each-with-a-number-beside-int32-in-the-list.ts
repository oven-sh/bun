// one is added to each: a number beside int32 in the list
const said: string[] = [];
function work(list: number[], out: number[], from: number): number { for (let i = 0; i < list.length; i++) list[i] = list[i] + 1; return 0; }
function make(): number[] { const made: number[] = []; for (let i = 0; i < 12; i++) made.push(i & 7); return made; }
function show(name: string, shown: any): string {
  let text = name + " " + shown.length + ":";
  for (let i = 0; i < 18; i++) text += " " + (i in shown ? (Object.is(shown[i], -0) ? "-0" : String(shown[i])) : "-");
  return text;
}
const list: number[] = make();
let out: number[] = make();

list[7] = 2147483647;
for (let round = 0; round < 2; round++) {
  try {
    const given: any = work(list, out, 1);
    console.log(Object.is(given, -0) ? "-0" : String(given));
  } catch (error) {
    console.log("thrown: " + (error as Error).name);
  }
  console.log(show("list", list));
  console.log(show("out", out));
}

console.log(said.join(", "));
export {};
