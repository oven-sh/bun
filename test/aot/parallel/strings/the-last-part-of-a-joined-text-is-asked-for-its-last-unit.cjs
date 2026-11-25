// A text joined of two or three parts, held where nothing types it, is asked for its end: the last part flat, a piece, joined itself, wide or one unit long; the end narrow, wide, joined, empty, longer than the last part, longer than the text.
"use strict";
const box = JSON.parse('{"a":"src/file","b":".tsx","c":"x","w":"\\u0142o","e":"","long":"0123456789abcdefghijklmnopqrstuvwxyz0123456789"}'), out = [];
const ends = JSON.parse('[".tsx","tsx","x","",".ts",".js","e.tsx","src/file.tsx","_src/file.tsx","\\u0142o","o","\\u0142","xx","x.tsx","9","e","file","filex","ex","z0123456789","0123456789abcdefghijklmnopqrstuvwxyz0123456789"]');
const held = { t: "" };
const makers = [
  () => box.a + box.b,
  () => box.a + box.b + box.c,
  () => box.a + box.w,
  () => box.w + box.b,
  () => box.a + box.b.slice(1),
  () => box.a + (box.b + box.c),
  () => (box.a + box.b) + box.c,
  () => box.a + box.long,
  () => box.long + box.long.slice(3, 40),
  () => box.e + box.a + box.b,
  () => box.a + box.c + box.c,
  () => box.b + box.a + box.c,
  () => box.c + box.b + box.a,
  () => `${box.b}${box.a}${box.c}`,
  () => box.b.concat(box.a, box.c),
  () => box.long + box.a + box.c,
];
for (let turn = 0; turn < 40; turn++) {
  out.length = 0;
  for (const make of makers) {
    for (const end of ends) { held.t = make(); out.push(+held.t.endsWith(end)); }
    held.t = make(); let all = ""; for (const end of ends) all += +held.t.endsWith(end); out.push(all);
    for (const end of ends) { held.t = make(); out.push(+held.t.endsWith(end + ""), +held.t.endsWith(box.e + end), +held.t.endsWith(end.slice(0, 1) + end.slice(1))); }
    held.t = make(); out.push(+held.t.endsWith("x", 3), +held.t.endsWith("c", 3), +held.t.endsWith(".tsx", held.t.length), held.t.length, held.t);
  }
  held.t = ""; let hits = "";
  for (const c of "ab\r\n\r\ncd\r\n\r\r\n\r\n\n") { held.t += c; hits += +held.t.endsWith("\r\n\r\n") + "" + +held.t.endsWith("\n") + +held.t.endsWith(c); }
  out.push(hits, held.t.length);
}
console.log(out.length, out.join(""));
