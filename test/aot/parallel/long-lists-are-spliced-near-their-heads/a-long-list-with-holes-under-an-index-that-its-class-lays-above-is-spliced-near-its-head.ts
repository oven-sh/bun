const n = 140000;
class Heir extends Array<any> {}
(Heir.prototype as any)[3] = "above";
Object.defineProperty(Heir.prototype, 5, { get() { return "got"; }, set(_) {}, configurable: true });
function make(): Heir { const list = new Heir(); for (let i = 0; i < n; i++) list.push(i); delete list[3]; delete list[5]; delete list[70000]; return list; }
function digest(list: any[]): string { let sum = 0, own = 0; for (let i = 0; i < 12; i++) { if (Object.hasOwn(list, i)) own++; sum = (sum * 31 + (typeof list[i] === "number" ? list[i] : 9)) | 0; } return list.length + ":" + sum + ":" + own + ":" + list[2] + ":" + list[3] + ":" + list[4] + ":" + list[5]; }
for (const at of [0, 1, 2, 3, 4, 6]) { const a = make(); const ra = a.splice(at, 1); const b = make(); b.splice(at, 0, -1); console.log(at, digest(a), String(ra[0]), digest(b)); }
