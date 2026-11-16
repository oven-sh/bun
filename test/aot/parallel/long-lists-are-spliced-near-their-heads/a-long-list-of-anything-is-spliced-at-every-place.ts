const n = 140000;
function make(): any[] { const list: any[] = []; for (let i = 0; i < n; i++) list.push(i & 1 ? i : "t" + (i & 7)); return list; }
function digest(list: any[]): string { let sum = 0; for (let i = 0; i < list.length; i++) { const x = list[i]; sum = (sum * 31 + (typeof x === "number" ? x * 2 : x === undefined ? 7 : 5)) | 0; } return list.length + ":" + sum + ":" + list[0] + ":" + list[1] + ":" + list[2] + ":" + list[list.length - 1]; }
const places: number[] = JSON.parse("[0, 1, 2, 7, 100, 19999, 39990, 40010, 69999, 70000, 139998, 139999, 140000, -1, -139999, -140000, -150000]");
const item: any = JSON.parse('"new"');
for (const at of places) {
  const a = make(); const ra = a.splice(at, 1);
  const b = make(); const rb = b.splice(at, 0, item);
  const c = make(); const rc = c.splice(at, 3, item);
  const d = make(); const rd = d.splice(at, 1, item, item, item);
  const e = make(); const re = e.splice(at, 5);
  const f = make(); const rf = f.splice(at, 2, item, item);
  console.log(at, digest(a), ra.join(), digest(b), rb.length, digest(c), rc.join(), digest(d), rd.join(), digest(e), re.join(), digest(f), rf.join());
}
