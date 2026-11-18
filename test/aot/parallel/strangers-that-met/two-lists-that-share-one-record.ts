const shared = { name: "shared", both: true };
const l0 = { name: "l0", a: 0 }, l1 = { name: "l1", b: 0 }, l2 = { name: "l2", c: 0 }, l3 = { name: "l3", d: 0 };
const r0 = { size: 1, e: 0 }, r1 = { size: 2, f: 0 }, r2 = { size: 3, g: 0 }, r3 = { size: 4, h: 0 };
const named: { name: string }[] = [l0, l1, shared, l2, l3];
const mixed: object[] = [r0, r1, shared, r2, r3];
function names(list: { name: string }[]): string { let s = ""; for (const o of list) s += o.name + ","; return s; }
function sizes(list: any[]): string { let s = ""; for (const o of list) s += String(o.size) + String(o.name) + ","; return s; }
console.log(names(named), sizes(mixed));
