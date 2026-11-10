const n = 140000;
function digest(list: any[]): string { let sum = 0; for (let i = 0; i < list.length; i++) { const x = list[i]; sum = (sum * 31 + (typeof x === "number" ? x * 2 : 5)) | 0; } return list.length + ":" + sum + ":" + list[0] + ":" + list[1] + ":" + list[2]; }
function whole(): any[] { const list: any[] = []; for (let i = 0; i < n; i++) list.push(i); return list; }
function fractions(): any[] { const list: any[] = []; for (let i = 0; i < n; i++) list.push(i + 0.5); return list; }
const items: any[] = JSON.parse('[1.5, "text", null, 7]'); items.push(NaN, undefined);
for (const item of items) { const a = whole(); a.splice(1, 0, item); const b = fractions(); b.splice(1, 0, item); const c = whole(); c.splice(2, 1, item, item); const d = fractions(); d.splice(2, 1, item, item); console.log(String(item), digest(a), digest(b), digest(c), digest(d)); }
