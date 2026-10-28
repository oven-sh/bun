// a.c = other repoints. The old inner object stays what it was for its aliases, and nothing is copied.
interface Inner { d: number; e: number; s: string }
interface Outer { b: number; c: Inner }
function make(i: number): Outer { return { b: i, c: { d: i + 1, e: i + 2, s: "i" + i } }; }
const list: Outer[] = [];
for (let i = 0; i < 6000; i++) list.push(make(i));
const old: Inner[] = list.map(o => o.c);
Bun.gc(true);
for (let i = 0; i < list.length; i++) {
  if (i % 3 === 0) list[i].c = list[(i + 1) % list.length].c;
  else if (i % 3 === 1) list[i].c = { d: -i, e: -i, s: "new" + i };
}
Bun.gc(false); Bun.gc(true);
let s = 0, same = 0, text = 0;
for (let i = 0; i < list.length; i++) {
  s += list[i].c.d + list[i].c.e + old[i].d * 2 + old[i].e; text += list[i].c.s.length + old[i].s.length;
  if (list[i].c === old[i]) same++;
}
console.log(s, same, text);
list[0].c.d = 99; console.log(old[1].d, old[0].d, list[1].c.d);
old[0].d = 7; console.log(list[0].c.d, old[0].d);
const anyList: any[] = list;
for (let i = 0; i < anyList.length; i += 5) anyList[i].c = i % 2 ? "a string" + i : i % 3 ? null : i;
Bun.gc(true);
let kinds = ""; for (let i = 0; i < 40; i += 5) kinds += typeof anyList[i].c + ","; console.log(kinds);
let t = 0; for (const c of old) t += c.d + c.s.length; console.log(t);
