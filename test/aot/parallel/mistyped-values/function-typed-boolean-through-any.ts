// Through `any` a function reaches `f` as a boolean, and `f` goes on in its slower version.
// There `b` is read by `${b}` and then narrowed to two bits, with more values alive across the calls than registers that outlive a call.
class K { a!: number; constructor(v: number) {} }
function f(b: boolean, s: string): void {
  const t: string = `<${b}>`;
  const x: number = b ? 0 : 1;
  const y: number = b ? 2 : 0;
  const z: number = x * y;
  if ((z & 3) === 0) { if (b) { console.log(t + s); } }
  new K(x);
  if (x < (3 ^ (1 | z))) new K(y);
}
function g(n: number): void { new K(n); }
for (let i = 0; i < 5; i++) f(true, "true");
const anything: any = Object.prototype.toString;
const odd: boolean = anything;
f(odd, "toString");
g(0.5);
f(false, "x");
console.log("end");
