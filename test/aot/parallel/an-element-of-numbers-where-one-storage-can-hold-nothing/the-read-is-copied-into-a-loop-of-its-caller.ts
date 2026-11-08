function note(value: any): void {}
let seen = 0;
function total(list: number[]): any {
  let sum: any = 0;
  if (!(list[0] == 100.5)) {
  }
  sum += list[0];
  return sum;
}
const fractions: any = [1.5, 2.5, 100.5];
let all = 0;
for (let turn = 0; turn < 300; turn++) all += total(fractions);
console.log(String(all));
note(fractions);
const records: any = [{ value: 100 }];
note(records);
const made: any = [{ value: 1 }].map((each: any) => new (class { value = each.value; })());
note(made);
try { (null as any).gone; } catch (error) { note("threw " + (error as any)?.constructor?.name); }
console.log(String(seen));
