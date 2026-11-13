// Records of one layout whose keys come in several orders, with objects and lists in other places; each is written again.
interface Inner { x: number; y: string; }
interface Row { name: string; inner: Inner | null; list: number[]; n: number; other: Inner | string; }
const orders: (keyof Row)[][] = [["name", "inner", "list", "n", "other"], ["inner", "name", "n", "other", "list"], ["n", "list", "other", "name", "inner"], ["other", "n", "inner", "list", "name"], ["list", "other", "name", "inner", "n"]];
function row(i: number): Row { return { name: "name" + (i % 3), inner: i % 4 === 3 ? null : { x: i % 5, y: "inner" }, list: i % 2 ? [1, 2] : [], n: i % 7, other: i % 3 ? "other" : { x: 9, y: "more" } }; }
function written(i: number, order: (keyof Row)[]): string { const r: any = row(i); return "{" + order.map(k => JSON.stringify(k) + ":" + JSON.stringify(r[k])).join() + "}"; }
let sum = 0;
for (let turn = 0; turn < 30; turn++) {
  const texts: string[] = [];
  for (let i = 0; i < 80; i++) texts.push(written(i % 6, orders[(i * (turn + 1) + (i >> 2)) % orders.length]!));
  const source = "[" + texts.join() + "]";
  const rows: Row[] = JSON.parse(source);
  if (JSON.stringify(rows) !== source) console.log("differs", turn);
  for (let i = 0; i < 80; i += 5) { const r = rows[i]!; if (r.inner) r.inner.x += 100; r.list.push(i); if (typeof r.other !== "string") r.other.y = "changed"; }
  let others = 0;
  for (let i = 0; i < 80; i++) if (i % 5 && JSON.stringify(rows[i]) !== texts[i]) others++;
  for (const r of rows) sum += r.n + r.list.length + (r.inner ? r.inner.x + r.inner.y.length : 1) + (typeof r.other === "string" ? r.other.length : r.other.x) + r.name.length;
  console.log(others, sum);
}
