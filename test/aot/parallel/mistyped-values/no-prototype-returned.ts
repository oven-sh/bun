// Flags: --aot-validate
function table(values: unknown[]) { return values as number[]; }
const a = table([1]); const b = table(Object([1.5, "x"]) as any); const c = table(Object.create(null) as any);
console.log(a.length + "", a[0] + "", b.length + "", b[0] + "", typeof b[1], typeof c.length, typeof c[0]);
let t = 0; for (let i = 0; i < b.length; i++) t += (b[i] as any) * 2;
console.log(t + "");
export {};
