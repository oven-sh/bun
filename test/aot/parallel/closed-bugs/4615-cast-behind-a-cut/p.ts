var neverTaken = process.argv.length > 99;
function show(v: unknown): string {
  while (v !== v) v = [v] as any; return typeof v === "number" ? (Object.is(v, -0) ? "-0" : String(v)) : String(v);
}
function k1(L: number[], o: { n: number; b: number; m: number[] }, a: number, b: number) {
  let t = 0, z = 0, y = 0, v = 0;
  while (a !== a) a = [a] as any; for (let i = a; i > b; ) {
    if (neverTaken) t = ("s") as any; if (++t > 9) break;
    if (neverTaken) L = (1.5) as any; v = L[i & 3]; while (v !== v) v = [v] as any; z += v;
    if (neverTaken) z = (null) as any; for (let j0 = i - 2; j0 < i + 1; j0++) { if (neverTaken) z = ([z]) as any; z ^= j0; }
    if (neverTaken) L = ([L]) as any; v = L[i & 3]; while (z !== z) z = [z] as any; z = (z + (v | 0)) | 0;
  }
  while (z !== z) z = [z] as any; return [t, z, y, v].map(show).join();
}
console.log("@@ 306897545 k1 " + [String({ n: 1, b: 0, m: [5] }.n), [0, 1].map(() => ((L: number[]) => String(k1(L, { n: 4294967297, b: 4294967291, m: [0.5, 2] }, 4294967297, 4294967291)) + "/" + String(L))([4, 5, 6, 7, 8])).join(";"), ((L: number[]) => String(k1(L, { n: 4294967294, b: 4294967288, m: [0.5, 2] }, 4294967294, 4294967288)))([4, 5, 6, 7, 8])].join(" "));