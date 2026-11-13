// What filter keeps goes behind the last place of its result: more than the result holds at first, of every kind, with holes, and where its callback changes what it reads.
class Sub extends Array<any> {}
const lists: any[][] = [
  Array.from({ length: 90 }, (_, k) => (k * 37) % 101),
  Array.from({ length: 90 }, (_, k) => k * 0.5),
  [1, 2, NaN, 4, 0.5, -0, 7, Infinity, 9, 10],
  [1, "a", 2.5, null, undefined, 6, true, 8, {}, 10],
  [1, , 3, , 5, 6, , 8],
  "the quick brown fox jumps over the lazy dog".split(" "),
  Array.from({ length: 70 }, (_, k) => 2147483600 + k * 3),
  Array.from({ length: 90 }, (_, k) => (k < 80 ? k : "t" + k)),
  Array.from({ length: 700 }, (_, k) => k),
  [],
  Sub.from([3, 1, 4, 1, 5, 9, 2, 6]) as any[],
];
function show(r: any[]): string {
  let h = 0;
  for (let k = 0; k < r.length; k++) {
    const x = r[k];
    h = (Math.imul(h, 31) + (k in r ? (typeof x === "number" ? (Object.is(x, -0) ? 3 : x % 1 ? Math.floor(x * 8) | 0 : x | 0) : typeof x === "string" ? x.length + 7 : 11) : 17)) | 0;
  }
  return r.length + ":" + h + (r instanceof Sub ? "s" : "");
}
for (let t = 0; t < 6; t++) {
  const line: string[] = [];
  for (const L of lists) {
    line.push(show(L.filter((x: any) => x % 3 !== 0)), show(L.filter((_: any, i: number) => i & 1)), show(L.filter(Boolean)));
    line.push(show(L.map((x: any) => (x | 0) * 2 + t)), show(L.map((x: any) => (x | 0) * 2147483647 - t)), show(L.map((x: any) => x * 2)));
    const M = L.slice();
    line.push(show(M.filter((x: any, i: number) => { if (i === 2 && M.length < 800) M.push(x, 0.5, "z"); if (i === 3) delete M[5]; return i !== 1; })), show(M));
    const out: any[] = [];
    let n = 0;
    for (let i = 0; i < L.length; i++) if (L[i] % 2 === 0) out[n++] = L[i];
    line.push(show(out));
    line.push(String(L.filter((x: any) => typeof x === "number" && x % 3 !== 0).map((x: any) => x * 2 + t).reduce((a: number, x: number) => a + (x & 1023), 0)));
  }
  console.log(line.join(" "));
}
