// `while (i < n)` with `n = n + 1` inside: the first test stands in front of the loop, and what it says about n goes into the loop as a result of that edge, not as an argument. The build stopped in ConvertCountersToIntegers.
const lines = [];
function show(v, d) {
  if (v === null || typeof v !== "object") return String(v);
  return "{" + Object.keys(v).map(k => k + ": " + show(v[k], (d | 0) + 1)).join(", ") + "}";
}
let reads = 0;
let log = [];
function f(a, b, t, n, o, q, w) {
  let sum = 0, cnt = 0, g = 0, hits = 0, prod = 1, mx = -Infinity, s = "", big = 0n, last, fuel = 0, dead = 0, deadG = 0, deadS = "", inv;
  const ends = [], fns = [];
  {
    let i = n & 3;
    while (i < n) {
      let j1 = n & 3;
      while (j1 !== a.length) {
        let k2 = a.length - 1;
        for (; k2 >= 1; k2--) {
          try { if (k2 === 32) { ++j1; { i += 3; continue; } } cnt++; } finally { g++; }
          if (a[k2] === undefined) break;
        }
        ends.push(k2);
        n = n + 1;
        if (++g > 8) break;
        s += w[j1];
        ++j1;
      }
      ends.push(j1);
      if (i === 2) a.pop();
      i += 3;
    }
    ends.push(i);
  }
  if (n & 1) inv = o.list.length;
  else {
    for (let i3 = n & 3; i3 < 256; i3 = i3 * 2 + 1) {
      if (++fuel > 300) throw new Error("fuel");
    }
    let i4 = 31 - 1;
    for (; i4 > 0; --i4) {
      if (++fuel > 300) throw new Error("fuel");
      try { if (a[i4] === 1) throw i4; } catch (e) { hits += 2; break; }
      if (++g > 8) break;
      sum += a[i4] * 0.5;
    }
    ends.push(i4);
  }
  return ["end", sum, cnt, g, hits, prod, mx, s, big, last, inv, n, ends, fns.map(x => x())];
}
function go(at, a, b, t, n, same, w) {
  if (b === "a") b = a; if (b === "t") b = t; if (a === "t") a = t;
  const o = { m: 3, t: "Ā", list: [1, 2, 3] }, q = same ? o : { m: 4 };
  let r; try { r = f(a, b, t, n, o, q, w); } catch (e) { r = ["threw", e && e.name]; }
  lines.push(at + " " + show(r) + " | " + show(a) + " | " + show(b) + " | " + show(t) + " | " + show(o) + " " + show(q) + " | " + show(log) + " " + reads);
}
for (let round = 0; round < 3; round++) {
  go(0, "t", Array.from({ length: 7 }, (_, x) => -x), new Float64Array(16), 9, false, "abcab");
  go(1, Object.freeze(Array.from({ length: 3 }, (_, x) => x)), Array.from({ length: 32 }, (_, x) => x === 2 ? NaN : x), new Int8Array(0), 1, false, "");
}
console.log(lines.join("\n"));