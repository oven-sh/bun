function again(B: new () => object) { return class Again extends B { n = 1; deep(): number { return this.n; } }; }
let held = Object as unknown as ReturnType<typeof again>;
held = again(held); const once = held; held = again(held);
(once as any).tag = 1; (held as any).tag = 2;
console.log(new held().deep(), new once().deep(), (once as any).tag, (held as any).tag, new held() instanceof once, new once() instanceof held, Object.keys(new held()).join());
export {};
