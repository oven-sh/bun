function note(value: any): void {}
function total(list: number[]): any {
  let sum: any = 0;
  for (let i = 0, n = list.length; i < n; i++) {
    if (list[i] == 100.5) sum += 1;
  }
  return sum;
}
const fractions: any = [1.5, 2.5, 100.5];
console.log(String(total(fractions)));
note(fractions);
note([{ value: 100 }]);
note([{ other: 1 }]);
note([{ third: "x" }]);
try { (null as any).gone; } catch (error) { note("threw " + (error as any)?.constructor?.name); }
