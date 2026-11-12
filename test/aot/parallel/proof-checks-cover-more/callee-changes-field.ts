// Flags: --aot-harden=proof-checks
// STATISTIC: HoistedCallProofsChecked >= 1
const outside: any = JSON.parse("{}");
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
class Holder {
  s: string = " aBc ";
  t: string = "z";
  k: number = 2;
}
function run(list: string[], o: Holder, f: (o: Holder, i: number) => void): number {
  let n = 0;
  for (let i = 0; i < list.length; i++) {
    if (list[i] === o.s.trim()) n += i;
    f(o, i);
  }
  return n;
}
outside.kept = run;
let warm = 0;
for (let i = 0; i < 2000; i++) warm += run(list, new Holder(), () => {});
console.log(warm);
console.log(
  attempt(() =>
    run(list, new Holder(), (o, i) => {
      if (i === 3) {
        o.s = " Xy ";
        o.t = "w";
        o.k = 3;
      }
    }),
  ),
);
console.log(attempt(() => run(list, new Holder(), () => {})));
