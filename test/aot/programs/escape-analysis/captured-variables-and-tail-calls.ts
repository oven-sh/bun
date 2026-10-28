// A function with stack-allocated captured variables is reached through a tail call from a function with a rest parameter.
function noise(k: number): number { let a = k, b = k + 1, c = k + 2, d = k + 3; for (let i = 0; i < 3; i++) { a += b; b += c; c += d; d += a; } return a + b + c + d; }
const fars: ((k: number) => number)[] = [noise, k => noise(k) + 1];
function far(k: number): number { return fars[k & 1](k) % 101; }
function outer(...xs: number[]): string { //! frame; removed
  let v = xs[0];
  let w = "s" + xs[0];
  const list: string[] = [w];
  function inner(k: number): string {
    // Many values that live across calls: the frame of `inner` is larger than the entry's and is written all over.
    const t0 = far(k), t1 = far(k + 1), t2 = far(k + 2), t3 = far(k + 3), t4 = far(k + 4), t5 = far(k + 5), t6 = far(k + 6), t7 = far(k + 7);
    const t8 = far(k + 8), t9 = far(k + 9), ta = far(k + 10), tb = far(k + 11), tc = far(k + 12), td = far(k + 13), te = far(k + 14), tf = far(k + 15);
    const acc = (t0 + t1 * 2 + t2 * 3 + t3 * 5 + t4 * 7 + t5 * 11 + t6 * 13 + t7 * 17 + t8 * 19 + t9 * 23 + ta * 29 + tb * 31 + tc * 37 + td * 41 + te * 43 + tf * 47) % 1009;
    v += 1;
    list.push(w + k);
    if (k > 6) return inner(k - 3);
    if (k > 3) return inner(k - 2);
    if (k > 0) return inner(k - 1);
    return v + ":" + w + ":" + list.length + ":" + list[list.length - 1] + ":" + acc;
  }
  return inner(8);
}
(globalThis as any).hidden = outer;
let out = "";
for (let i = 0; i < 400; i++) {
  const r: string = (globalThis as any).hidden(i);
  if (i % 80 === 0) out += r + "\n";
}
console.log(out);
