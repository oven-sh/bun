check(n => { let s = 0; for (let i = 0; i < 30; i++) s += n; return s; }, singles);
check(n => { let s = 1; for (let i = 0; i < 40; i++) s = s * 2 + n; return s; }, singles);
check(n => { let a = 1, b = n; for (let i = 0; i < 31; i++) [a, b] = [b, a]; return [a, b]; }, () => [[1], [0.5], ["x"], [null]]);
check(n => { let s = 0; outer: for (let i = 0; i < 9; i++) { for (let j = 0; j < 9; j++) { if (j > n) continue outer; if (i > 6) break outer; s += j; } s++; } return s; }, singles);
check(n => { let s = 0; do { do { s += n; } while (0); s++; } while (s < 50 && s > 0); return s; }, () => [[1], [0.5], [-9]]);
check(n => { switch (n) { case 0: return "a"; case 1: return "b"; case 7: return "c"; default: return "d"; } }, singles);
check(n => { while (n-- > 0 && n < 50); return n; }, singles);
check(function (a, b) { const old = a; a = b; a = old; return typeof a + arguments.length; }, pairs);
check(n => { function* g() { for (let i = 0; i < 5; i++) { for (let j = 0; j < 3; j++) yield i * j + n; yield i; } } return [...g()].join(); }, () => [[1], [0.5], ["x"]]);
checkInTurn(
  a => { let n = 0; for (let i = 0; i < 40; i++) { if (i < a) for (let j = 0; j < 40; j++) n += j; n ^= i; } return n; },
  () => [[40], [3], [0]], 4,
);
checkInTurn(
  a => { const it = (function* () { for (let n = 0; n < 200; n++) if (n < a) yield n; })(); return [...it].length; },
  () => [[200], [100], [0]], 4,
);
checkInTurn(
  (n, hit) => {
    let s = 0, up = false;
    for (let k = 0; k < n; k++) {
      if (k % hit == 0) { for (let i = 0; i < 20000; i++) s = (s + i) | 0; up = true; }
      s += up ? 1 : 2;
      up = (k & 3) == 1;
    }
    return s;
  },
  () => [[6, 5], [6, 1], [3, 7]], 4,
);
checkInTurn(
  step => {
    function* g() {
      let seen = false, n = 0;
      while (n < 400) { if (n % step == 0) { yield n; seen = true; } n += seen ? 1 : 2; seen = (n & 4) == 0; }
    }
    let total = 0;
    for (const value of g()) total += value;
    return total;
  },
  () => [[3], [1], [11]], 4,
);
