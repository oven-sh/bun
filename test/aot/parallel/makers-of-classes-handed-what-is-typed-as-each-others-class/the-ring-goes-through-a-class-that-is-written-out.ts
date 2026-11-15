function made(B: new () => object) { return class Made extends B { m() { return 1; } }; }
let held = Object as unknown as typeof Written;
const Below = made(held);
class Written extends Below { w() { return 2 + this.m(); } }
held = Written;
(Below as any).extra = 1; (Written as any).extra = 5; (Below as any).extra = 2;
console.log(new Written().w(), new Below().m(), (Below as any).extra, (Written as any).extra, new Written() instanceof Below, new Below() instanceof Written, "w" in new Below());
export {};
