function make(n: number, kind: number): any[] { const list: any[] = []; for (let i = 0; i < n; i++) list.push(kind === 0 ? i : kind === 1 ? i + 0.5 : i & 1 ? i : "t"); if (kind === 3) { delete list[1]; delete list[n >> 1]; } return list; }
function digest(list: any[], at: number): string { let sum = 0, holes = 0; for (let i = 0; i < list.length; i += 991) { if (!(i in list)) holes++; const x = list[i]; sum = (sum * 31 + (typeof x === "number" ? x * 2 : 5)) | 0; } let near = ""; for (let i = Math.max(at - 2, 0); i < at + 5; i++) near += String(list[i]) + ","; return list.length + ":" + sum + ":" + holes + ":" + near + String(list[0]) + ":" + String(list[list.length - 1]); }
const bound = 100000;
for (let kind = 0; kind < 4; kind++) {
  const item: any = kind === 1 ? -0.5 : kind === 2 ? "new" : -1;
  for (const [n, at] of [[bound + 3, 1], [bound + 3, 2], [bound + 3, 3], [bound + 3, 4], [2 * bound + 40, bound + 18], [2 * bound + 40, bound + 19], [2 * bound + 40, bound + 20], [2 * bound + 40, bound + 21], [2 * bound + 40, bound + 22]] as [number, number][]) {
    const a = make(n, kind); const ra = a.splice(at, 1);
    const b = make(n, kind); const rb = b.splice(at, 0, item);
    const c = make(n, kind); const rc = c.splice(at, 1, item, item, item);
    const d = make(n, kind); const rd = d.splice(at, 4, item, item);
    console.log(kind, n, at, digest(a, at), String(ra), digest(b, at), rb.length, digest(c, at), String(rc), digest(d, at), String(rd));
  }
}
