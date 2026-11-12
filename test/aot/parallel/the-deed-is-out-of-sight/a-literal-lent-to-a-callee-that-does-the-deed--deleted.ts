const strip: (o: any, k: string) => void = [new Function("o", "k", "delete o[k]") as any][JSON.parse("0")];
const define: typeof Object.defineProperty = (Object as any)[JSON.parse('"defineProperty"')];
const freeze: typeof Object.freeze = (Object as any)[JSON.parse('"freeze"')];
const unseen = (x: any): any => [x][JSON.parse("0")];
const say = (value: unknown): string => typeof value + ":" + String(value);
interface Row { first: number; second: number; third: string }
function make(seed: number): Row { return { first: seed, second: seed + 1, third: "t" + seed }; }
const shelf: Row[] = [];
const key: string = unseen("second");
function hurt(y: Row, c: boolean): void { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; if (c) { strip(y, "second"); } }
function run(x: Row, c: boolean): string {
  const mine: Row = { first: x.first, second: x.second, third: x.third };
  hurt(mine, c);
  const e: unknown = mine.first, f: unknown = mine.second, g: unknown = mine.third;
  return say(e) + say(f) + say(g) + Object.keys(mine).join();
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
