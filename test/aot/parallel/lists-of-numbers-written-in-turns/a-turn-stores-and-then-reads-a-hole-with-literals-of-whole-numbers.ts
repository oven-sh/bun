// a turn stores and then reads a hole: literals of whole numbers
// Under: --aot-check=Validate: where the look types the read behind the row otherwise than the walk does, the verifier stops the build; as built, the unit is walked a second time
const said: string[] = [];
function work(list: number[], out: number[], from: number): number { let s = 0; for (let i = 0; i < list.length; i++) { list[i] = list[i] + 1; s += out[i]; const v = out[i]; if (v === undefined) s = -1; } return s; }
function make(): number[] { return [0, 1, 2, 3, 4, 5, 6, 7, 0, 1, 2, 3]; }
function show(name: string, shown: any): string {
  let text = name + " " + shown.length + ":";
  for (let i = 0; i < 18; i++) text += " " + (i in shown ? (Object.is(shown[i], -0) ? "-0" : String(shown[i])) : "-");
  return text;
}
const list: number[] = make();
let out: number[] = make();


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
console.log(show("the literal again", make()));
console.log(said.join(", "));
export {};
