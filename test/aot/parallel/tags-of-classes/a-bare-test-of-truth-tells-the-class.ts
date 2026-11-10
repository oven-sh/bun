// STATISTIC: MethodCallsThroughTable = 0
// `if (result.ok)` says as much as `if (result.ok === true)`: on each side the class is known, and `double` is called directly.
class Ok { readonly ok = true; constructor(readonly value: number) {} double(): Ok { return new Ok(this.value * 2); } }
class Err { readonly ok = false; constructor(readonly error: string) {} double(): Err { return this; } }
function check(amount: number): Ok | Err { return amount > 10 ? new Ok(amount) : new Err("small"); }
const amounts: number[] = JSON.parse("[5,20,7,40,11,3,99,10]");
function run(t: number): number {
  let sum = t & 3;
  for (const amount of amounts) {
    const result = check(amount);
    if (result.ok) sum += result.double().value;
    else sum += result.double().error.length;
    if (!result.ok) sum += result.error.length;
    sum += result.ok ? result.value : 1;
  }
  return sum;
}
let all = 0;
for (let t = 0; t < 5; t++) all = (all + run(t)) % 1000003;
console.log(all);
