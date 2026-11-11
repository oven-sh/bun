interface Odd { a: number; b?: number; c: string; }
function OddF(this: Odd, a: number) { this.a = a; if (a & 1) this.b = a * 2; this.c = "c" + a; }
const Odd = OddF as unknown as { new (a: number): Odd };
function tell(x: Odd): string { return x.a + ":" + typeof x.b + ":" + String(x.b) + ":" + x.c + ":" + ("b" in x); }
let text = "";
for (let i = 0; i < 300; i++) text = tell(new Odd(i)) + " " + tell(new Odd(i + 1));
console.log(text);
export {};
