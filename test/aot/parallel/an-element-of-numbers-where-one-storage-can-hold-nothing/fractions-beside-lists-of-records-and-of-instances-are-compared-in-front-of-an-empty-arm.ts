function note(value: any): void {}
function total(list: number[]): any {
  let sum: any = 0;
  for (let i = 0, n = list.length; i < n; i++) {
    if (!(list[i] == 100.5)) {
    }
    sum += list[i];
  }
  return sum;
}
const fractions: any = [1.5, 2.5, 100.5];
console.log(total(fractions));
note(fractions);
const records: any = [{ value: 100 }];
note(records);
const made: any = [{ value: 1 }].map((each: any) => new (class { value = each.value; })());
note(made);
try { (null as any).gone; } catch (error) { note("threw " + (error as any)?.constructor?.name); }
