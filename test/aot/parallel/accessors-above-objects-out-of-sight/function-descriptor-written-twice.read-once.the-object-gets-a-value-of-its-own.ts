function Temp(this: any, c: number) { this.c = c; }
Object.defineProperty(Temp.prototype, "f", { get: function (this: any) { return this.c * 3; }, configurable: true });
Object.defineProperty(Temp.prototype, "f", { get: function (this: any) { return this.c * 2; }, set: function (this: any, v: number) { this.c = v / 2; }, configurable: true });
let during = 0;
function make(n: number): any { const made: any = new (Temp as any)(n); if (during === 1) Object.defineProperty(made, "f", { value: 100, writable: true, configurable: true }); if (during === 2) Object.defineProperty(made, "f", { get() { return 100; }, set(v) { (this as any).c = -v; }, configurable: true }); if (during === 3) Object.setPrototypeOf(made, { get f() { return 100; }, set f(v: number) { (this as any).c = -v; } }); if (during === 4) Object.freeze(made); return made; }
function use(o: any): string { return String(o.f); }
const first = make(1), second = make(2);
(globalThis as any).kept = first; (globalThis as any).other = second;
function tell(o: any): string { try { return use(o); } catch (error) { return (error as Error).name; } }
console.log(tell(first), tell(second));
Object.defineProperty(first, "f", { value: 100, writable: true, configurable: true });
console.log(tell(first), tell(second));
console.log(tell(make(3)));
