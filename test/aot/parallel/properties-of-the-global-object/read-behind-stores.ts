const xs: number[] = JSON.parse("[" + Array.from({ length: 20 }, (_, k) => (k * 37) % 11).join() + "]");
const g: any = globalThis;
g.count = 0; g.b = 1;
function run() { let s = 0; for (let i = 0; i < xs.length; i++) { (globalThis as any).count += xs[i]!; s = (s + (globalThis as any).b) | 0; } return s; }
for (const b of [1, 1, 2.5, "3", "3", 4, undefined, 5, { valueOf: () => 2 }, 6]) { g.count = 0; g.b = b; console.log(run(), g.count); }
function two() { let s = 0; for (let i = 0; i < xs.length; i++) { const x = xs[i]!; (globalThis as any).count += 1; (globalThis as any).other += x; s = (s + x + (globalThis as any).b) | 0; } return s; }
g.other = 0;
for (const b of [1, 1, "3", "3", 4, undefined, 5]) { g.count = 0; g.other = 0; g.b = b; console.log(two(), g.count, g.other); }
function inc() { let s = 0; for (let i = 0; i < xs.length; i++) { const x = xs[i]!; (globalThis as any).count++; s = (s + (globalThis as any).b) | 0; (globalThis as any).last = x; } return s; }
for (const b of [1, 1, "7", "7", 2]) { g.count = 0; g.b = b; console.log(inc(), g.count, g.last); }
function alias() { let s = 0; for (let i = 0; i < xs.length; i++) { g.count += xs[i]!; s = (s + g.b) | 0; } return s; }
for (const b of [1, 1, "7", "7", 2]) { g.count = 0; g.b = b; console.log(alias(), g.count); }
function turns(at: number) { let s = 0; g.b = 1; for (let i = 0; i < xs.length; i++) { const x = xs[i]!; (globalThis as any).count += x; s = (s + (globalThis as any).b) | 0; if (i === at) (globalThis as any).b = "9"; } return s; }
for (const at of [99, 99, 3, 7, 0]) { g.count = 0; console.log(turns(at), g.count); }
function gone(at: number) { let s = 0; g.b = 1; for (let i = 0; i < xs.length; i++) { const x = xs[i]!; (globalThis as any).count += x; s = (s + (globalThis as any).b) | 0; if (i === at) delete g.b; } return s; }
for (const at of [99, 99, 3, 7, 0]) { g.count = 0; console.log(gone(at), g.count); }
