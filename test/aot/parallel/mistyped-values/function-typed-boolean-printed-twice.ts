// As function-typed-boolean-read-from-record-by-inherited-name.ts, but `b` is made into text twice and the text is used again at the end.
// What it did went by what the stack held: it crashed, or it printed `<-1.017909628459501|-1.017909628459501>odd` and ended with 0.
class K {
  a!: number;
  constructor(v: number) {}
}
function f(b: boolean, s: string): void {
  const t: string = `<${b}|${b}>`;
  const x: number = b ? 0 : 1;
  const y: number = b ? 2 : 0;
  const z: number = x * y;
  if (z === 0) {
    if (b) {
      console.log(t + s);
    }
  }
  new K(x);
  if (x < (3 ^ (1 | z))) new K(y);
  console.log(t.length);
}
function g(n: number): void {
  new K(n);
}
for (let i = 0; i < 1; i++) f(true, "true");
const r: Record<string, boolean> = { k: false };
const odd: boolean = r["toString"];
try {
  f(odd, "odd");
} catch (e) {
  console.log("throws", (e as Error).name, (e as Error).message);
}
g(0.5);
try {
  f(false, "x");
} catch (e) {
  console.log("throws", (e as Error).name, (e as Error).message);
}
console.log("end");
