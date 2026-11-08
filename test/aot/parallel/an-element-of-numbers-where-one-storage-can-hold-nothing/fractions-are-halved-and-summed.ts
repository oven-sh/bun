function note(value: any): void {}
let seen = 0;
function total(list: number[]): any {
  let sum: any = 0;
  for (let i = 0, n = list.length; i < n; i++) {
    sum += list[i] / 2;
  }
  return sum;
}
const given: any = [1.5, 2.5, 100.5];
console.log(String(total(given)));
console.log(String(given));
note(given);
const records: any = [{ value: 100 }];
note(records);
const made: any = [{ value: 1 }].map((each: any) => new (class { value = each.value; })());
note(made);
try { (null as any).gone; } catch (error) { note("threw " + (error as any)?.constructor?.name); }
console.log(String(seen));
