// q++ in the middle of an iteration, a break behind it, and nothing reads q behind the loop: the exit still names the next q.
let n = 4, counted = 0;
function first() {
  let q = 0, last;
  while (q < n >> 1) { last = q; q++; if (counted++ > 300) break; }
  const total = q;
  return last;
}
function second(a, limit) {
  let q = 0, p = 0, last = -1;
  while (q < limit) {
    last = a[q++];
    if (last > 40) break;
    p += 2;
    if (p > 90) { const unread = q + p; break; }
  }
  const total = q, steps = p;
  return last;
}
function third(a, limit) {
  let q = limit, s = 0;
  for (;;) {
    if (--q < 0) break;
    s += a[q];
    if (s > 500) { const unread = q; return s; }
  }
  const total = q;
  return s;
}
function fourth(a, limit) {
  let q = 0, s = 0;
  outer: while (q < limit) {
    let k = 0;
    while (k < 4) { s += a[(q + k++) % a.length]; if (s % 7 === 3) { q++; continue outer; } if (s > 900) break outer; }
    q++;
    if (s < 0) { const unread = q; throw new Error("below"); }
  }
  const total = q;
  return s;
}
const said = [];
const a = Array.from({ length: 64 }, (_, i) => (i * 37) % 53);
for (let round = 0; round < 200; round++) {
  n = round % 11;
  said.push(first(), second(a, round % 64), third(a, round % 64), fourth(a, round % 64));
}
console.log(said.join());
