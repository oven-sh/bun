// Flags: --aot-harden=proof-checks
// STATISTIC: HoistedCallProofsChecked >= 1
const loose = (text: string): any => JSON.parse(process.env.MADE_UP_TEXT ?? text);
const attempt = (run: () => unknown): string => {
  try {
    return String(run());
  } catch (error) {
    return "THROWS " + (error as Error).constructor.name;
  }
};
const list: string[] = loose(
  '["ABC","abc","aBc"," aBc","aBc ","Bc ","Bc","Bc "," aBc z","XY","xy","Xy"," Xy","Xy ","y "," Xy w","y"]',
);
function run(list: string[], s: string, t: string, k: number): number {
  let n = 0;
  for (let i = 0; i < list.length; i++) {
    if (list[i] === "Xy") break;
    if (list[i] === s.trim()) n += i;
  }
  return n;
}
(globalThis as any).kept = run;
let warm = 0;
for (let i = 0; i < 2000; i++) warm += run(list, " aBc ", "z", 2);
console.log(warm);
console.log(attempt(() => run(list, loose('" aBc "'), loose('"z"'), loose("2"))));
console.log(attempt(() => run(list, " aBc ", "z", 2)));
