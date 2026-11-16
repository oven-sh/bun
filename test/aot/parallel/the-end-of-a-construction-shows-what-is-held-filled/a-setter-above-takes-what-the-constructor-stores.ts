interface Held { a: number; b: number; }
function HeldF(this: Held, a: number) { this.a = a; this.b = a * 2; }
const Held = HeldF as unknown as { new (a: number): Held };
function tell(x: Held): string { return typeof x.a + ":" + String(x.a) + " " + typeof x.b + ":" + String(x.b) + " " + Object.keys(x).join(); }
let text = "";
for (let i = 0; i < 300; i++) text = tell(new Held(i));
console.log(text);
let taken = 0;
Object.defineProperty(HeldF.prototype, "b", { set(v: number) { taken += v; }, get() { return -1; }, configurable: true });
console.log(tell(new Held(5)), taken);
delete (HeldF.prototype as any).b;
console.log(tell(new Held(6)), taken);
export {};
