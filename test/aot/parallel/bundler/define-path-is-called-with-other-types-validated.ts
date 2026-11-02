// A call through a defined name whose value is a dotted path calls the method of the const with a string where the method declares a number.
// Flags: --define CALL=holder.bump --aot-validate --aot-check=ClaimsToBackEnd
class Counter {
  n = 1;
  bump(by: number): number {
    this.n += by;
    return this.n;
  }
}
declare const CALL: (by: string) => string;
const holder = new Counter();
function spin(c: Counter): number {
  let last = 0;
  for (let i = 0; i < 100; i++) last = c.bump(1);
  return last;
}
console.log(spin(holder));
const r = CALL("x");
console.log(r, typeof holder.n, spin(new Counter()), typeof spin(holder));
export {};
