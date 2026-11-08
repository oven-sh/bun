const unseen = (x: any): any => [x][JSON.parse("0")];
const say = (value: unknown): string => typeof value + ":" + String(value);
interface Row { first: number; second: number; third: string }
function make(seed: number): Row { return { first: seed, second: seed + 1, third: "t" + seed }; }
const shelf: Row[] = [];
const key: string = unseen("second");
function run(x: Row, c: boolean): string {
  let text = "";
  for (let i = 0; i < 4; i++) { const e: unknown = x.first, f: unknown = x.second, g: unknown = x.third; text += say(e) + say(f) + say(g) + ";"; if (c && i === 1) { delete (x as any)[key]; } }
  return text;
}
const runs: ((...all: any[]) => any)[] = [run, unseen(run)];
unseen(make(0));
let last: unknown = "";
for (let i = 0; i < 300; i++) { const one = unseen(make(i)); shelf[0] = one; last = runs[JSON.parse("0")](one, unseen(false)); }
console.log("warm", last);
const odd = unseen(make(5)); shelf[0] = odd;
console.log("hurt", runs[JSON.parse("0")](odd, unseen(true)));
console.log("kept", say(unseen(odd).second), Object.keys(odd).join());
console.log("again", runs[JSON.parse("0")](odd, unseen(false)));
const whole = unseen(make(6)); shelf[0] = whole;
console.log("whole", runs[JSON.parse("0")](whole, unseen(false)));
export {};
