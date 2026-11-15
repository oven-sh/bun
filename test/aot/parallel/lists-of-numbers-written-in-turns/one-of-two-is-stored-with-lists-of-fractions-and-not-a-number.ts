// one of two is stored: lists of fractions, the parameter is not a number
const said: string[] = [];
function work(list: number[], out: number[], from: number): number { for (let i = 0; i < list.length; i++) { const v = list[i]; out[i] = v > 3 ? v : from; } return 0; }
function make(): number[] { const made: number[] = []; for (let i = 0; i < 12; i++) made.push(i + 0.5); return made; }
function show(name: string, shown: any): string {
  let text = name + " " + shown.length + ":";
  for (let i = 0; i < 18; i++) text += " " + (i in shown ? (Object.is(shown[i], -0) ? "-0" : String(shown[i])) : "-");
  return text;
}
const list: number[] = make();
let out: number[] = make();


for (let round = 0; round < 2; round++) {
  try {
    const given: any = work(list, out, NaN);
    console.log(Object.is(given, -0) ? "-0" : String(given));
  } catch (error) {
    console.log("thrown: " + (error as Error).name);
  }
  console.log(show("list", list));
  console.log(show("out", out));
}

console.log(said.join(", "));
export {};
