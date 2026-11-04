// a field with a written type gets an accessor, and an accessor gets a value: the slot is left and nobody trusts its bits
class Holder { inner: { n: number } | undefined; constructor(n: number) { this.inner = { n }; } }
function read(h: Holder): string { const i = h.inner; return i ? String(i.n) : "none"; }
const all: Holder[] = []; for (let k = 0; k < 5; k++) all.push(new Holder(k));
Object.defineProperty(all[1], "inner", { get() { return { n: 100 }; }, configurable: true });
Object.defineProperty(all[2], "inner", { get() { return undefined; }, configurable: true });
Object.defineProperty(all[3], "inner", { get() { return { n: "text" } as any; }, configurable: true });
const before = all.map(read).join();
Object.defineProperty(all[1], "inner", { value: { n: 7 }, writable: true, configurable: true });
Object.defineProperty(all[3], "inner", { value: undefined, writable: true, configurable: true });
console.log(before, all.map(read).join());
