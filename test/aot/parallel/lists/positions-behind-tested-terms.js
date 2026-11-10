// Positions that are sums of a counter, behind a test of that counter against a length and a constant.
// STATISTIC: PositionsShownByTestedTerms >= 300
function f0_0_0_0(a, b, c, m) {
  let s = 0;
  for (let i = -1; i < (a.length - 1); i++) {
    if (++steps > 40) break;
    s += a[i - 1] + a[i] + a[i + 1];
  }
  return s;
}
function f0_0_1_1(a, b, c, m) {
  let s = 0;
  for (let i = -1; (a.length - 2) > i; i++) {
    if (++steps > 40) break;
    s += a[i - 1] + a[i] + a[i + 1];
  }
  return s;
}
function f0_0_2_0(a, b, c, m) {
  let s = 0;
  for (let i = -1; i < (a.length + 1); i++) {
    if (++steps > 40) break;
    s += a[i - 1] + a[i] + a[i + 1];
  }
  return s;
}
function f0_0_3_1(a, b, c, m) {
  let s = 0;
  for (let i = -1; (a.length - n) > i; i++) {
    if (++steps > 40) break;
    s += a[i - 1] + a[i] + a[i + 1];
  }
  return s;
}
function f0_0_4_0(a, b, c, m) {
  let s = 0;
  for (let i = -1; i < (m - 1); i++) {
    if (++steps > 40) break;
    s += a[i - 1] + a[i] + a[i + 1];
  }
  return s;
}
function f0_0_5_1(a, b, c, m) {
  let s = 0;
  for (let i = -1; (b.length - 1) > i; i++) {
    if (++steps > 40) break;
    s += a[i - 1] + a[i] + a[i + 1];
  }
  return s;
}
function f0_1_0_1(a, b, c, m) {
  let s = 0;
  for (let i = 0; (a.length - 1) > i; i++) {
    if (++steps > 40) break;
    s += a[i - 1] + a[i] + a[i + 1];
  }
  return s;
}
function f0_1_1_0(a, b, c, m) {
  let s = 0;
  for (let i = 0; i < (a.length - 2); i++) {
    if (++steps > 40) break;
    s += a[i - 1] + a[i] + a[i + 1];
  }
  return s;
}
function f0_1_2_1(a, b, c, m) {
  let s = 0;
  for (let i = 0; (a.length + 1) > i; i++) {
    if (++steps > 40) break;
    s += a[i - 1] + a[i] + a[i + 1];
  }
  return s;
}
function f0_1_3_0(a, b, c, m) {
  let s = 0;
  for (let i = 0; i < (a.length - n); i++) {
    if (++steps > 40) break;
    s += a[i - 1] + a[i] + a[i + 1];
  }
  return s;
}
function f0_1_4_1(a, b, c, m) {
  let s = 0;
  for (let i = 0; (m - 1) > i; i++) {
    if (++steps > 40) break;
    s += a[i - 1] + a[i] + a[i + 1];
  }
  return s;
}
function f0_1_5_0(a, b, c, m) {
  let s = 0;
  for (let i = 0; i < (b.length - 1); i++) {
    if (++steps > 40) break;
    s += a[i - 1] + a[i] + a[i + 1];
  }
  return s;
}
function f0_2_0_0(a, b, c, m) {
  let s = 0;
  for (let i = 1; i < (a.length - 1); i++) {
    if (++steps > 40) break;
    s += a[i - 1] + a[i] + a[i + 1];
  }
  return s;
}
function f0_2_1_1(a, b, c, m) {
  let s = 0;
  for (let i = 1; (a.length - 2) > i; i++) {
    if (++steps > 40) break;
    s += a[i - 1] + a[i] + a[i + 1];
  }
  return s;
}
function f0_2_2_0(a, b, c, m) {
  let s = 0;
  for (let i = 1; i < (a.length + 1); i++) {
    if (++steps > 40) break;
    s += a[i - 1] + a[i] + a[i + 1];
  }
  return s;
}
function f0_2_3_1(a, b, c, m) {
  let s = 0;
  for (let i = 1; (a.length - n) > i; i++) {
    if (++steps > 40) break;
    s += a[i - 1] + a[i] + a[i + 1];
  }
  return s;
}
function f0_2_4_0(a, b, c, m) {
  let s = 0;
  for (let i = 1; i < (m - 1); i++) {
    if (++steps > 40) break;
    s += a[i - 1] + a[i] + a[i + 1];
  }
  return s;
}
function f0_2_5_1(a, b, c, m) {
  let s = 0;
  for (let i = 1; (b.length - 1) > i; i++) {
    if (++steps > 40) break;
    s += a[i - 1] + a[i] + a[i + 1];
  }
  return s;
}
function f1_0_0_1(a, b, c, m) {
  let s = 0;
  for (let i = -1; (a.length - 1) > i; i++) {
    if (++steps > 40) break;
    s += a[i + 2] * 2 - a[i - 2];
  }
  return s;
}
function f1_0_1_0(a, b, c, m) {
  let s = 0;
  for (let i = -1; i < (a.length - 2); i++) {
    if (++steps > 40) break;
    s += a[i + 2] * 2 - a[i - 2];
  }
  return s;
}
function f1_0_2_1(a, b, c, m) {
  let s = 0;
  for (let i = -1; (a.length + 1) > i; i++) {
    if (++steps > 40) break;
    s += a[i + 2] * 2 - a[i - 2];
  }
  return s;
}
function f1_0_3_0(a, b, c, m) {
  let s = 0;
  for (let i = -1; i < (a.length - n); i++) {
    if (++steps > 40) break;
    s += a[i + 2] * 2 - a[i - 2];
  }
  return s;
}
function f1_0_4_1(a, b, c, m) {
  let s = 0;
  for (let i = -1; (m - 1) > i; i++) {
    if (++steps > 40) break;
    s += a[i + 2] * 2 - a[i - 2];
  }
  return s;
}
function f1_0_5_0(a, b, c, m) {
  let s = 0;
  for (let i = -1; i < (b.length - 1); i++) {
    if (++steps > 40) break;
    s += a[i + 2] * 2 - a[i - 2];
  }
  return s;
}
function f1_1_0_0(a, b, c, m) {
  let s = 0;
  for (let i = 0; i < (a.length - 1); i++) {
    if (++steps > 40) break;
    s += a[i + 2] * 2 - a[i - 2];
  }
  return s;
}
function f1_1_1_1(a, b, c, m) {
  let s = 0;
  for (let i = 0; (a.length - 2) > i; i++) {
    if (++steps > 40) break;
    s += a[i + 2] * 2 - a[i - 2];
  }
  return s;
}
function f1_1_2_0(a, b, c, m) {
  let s = 0;
  for (let i = 0; i < (a.length + 1); i++) {
    if (++steps > 40) break;
    s += a[i + 2] * 2 - a[i - 2];
  }
  return s;
}
function f1_1_3_1(a, b, c, m) {
  let s = 0;
  for (let i = 0; (a.length - n) > i; i++) {
    if (++steps > 40) break;
    s += a[i + 2] * 2 - a[i - 2];
  }
  return s;
}
function f1_1_4_0(a, b, c, m) {
  let s = 0;
  for (let i = 0; i < (m - 1); i++) {
    if (++steps > 40) break;
    s += a[i + 2] * 2 - a[i - 2];
  }
  return s;
}
function f1_1_5_1(a, b, c, m) {
  let s = 0;
  for (let i = 0; (b.length - 1) > i; i++) {
    if (++steps > 40) break;
    s += a[i + 2] * 2 - a[i - 2];
  }
  return s;
}
function f1_2_0_1(a, b, c, m) {
  let s = 0;
  for (let i = 1; (a.length - 1) > i; i++) {
    if (++steps > 40) break;
    s += a[i + 2] * 2 - a[i - 2];
  }
  return s;
}
function f1_2_1_0(a, b, c, m) {
  let s = 0;
  for (let i = 1; i < (a.length - 2); i++) {
    if (++steps > 40) break;
    s += a[i + 2] * 2 - a[i - 2];
  }
  return s;
}
function f1_2_2_1(a, b, c, m) {
  let s = 0;
  for (let i = 1; (a.length + 1) > i; i++) {
    if (++steps > 40) break;
    s += a[i + 2] * 2 - a[i - 2];
  }
  return s;
}
function f1_2_3_0(a, b, c, m) {
  let s = 0;
  for (let i = 1; i < (a.length - n); i++) {
    if (++steps > 40) break;
    s += a[i + 2] * 2 - a[i - 2];
  }
  return s;
}
function f1_2_4_1(a, b, c, m) {
  let s = 0;
  for (let i = 1; (m - 1) > i; i++) {
    if (++steps > 40) break;
    s += a[i + 2] * 2 - a[i - 2];
  }
  return s;
}
function f1_2_5_0(a, b, c, m) {
  let s = 0;
  for (let i = 1; i < (b.length - 1); i++) {
    if (++steps > 40) break;
    s += a[i + 2] * 2 - a[i - 2];
  }
  return s;
}
function f2_0_0_0(a, b, c, m) {
  let s = 0;
  for (let i = -1; i < (a.length - 1); i++) {
    if (++steps > 40) break;
    c[i] = (a[i - 1] + a[i] + a[i + 1]) / 3;
  }
  return s;
}
function f2_0_1_1(a, b, c, m) {
  let s = 0;
  for (let i = -1; (a.length - 2) > i; i++) {
    if (++steps > 40) break;
    c[i] = (a[i - 1] + a[i] + a[i + 1]) / 3;
  }
  return s;
}
function f2_0_2_0(a, b, c, m) {
  let s = 0;
  for (let i = -1; i < (a.length + 1); i++) {
    if (++steps > 40) break;
    c[i] = (a[i - 1] + a[i] + a[i + 1]) / 3;
  }
  return s;
}
function f2_0_3_1(a, b, c, m) {
  let s = 0;
  for (let i = -1; (a.length - n) > i; i++) {
    if (++steps > 40) break;
    c[i] = (a[i - 1] + a[i] + a[i + 1]) / 3;
  }
  return s;
}
function f2_0_4_0(a, b, c, m) {
  let s = 0;
  for (let i = -1; i < (m - 1); i++) {
    if (++steps > 40) break;
    c[i] = (a[i - 1] + a[i] + a[i + 1]) / 3;
  }
  return s;
}
function f2_0_5_1(a, b, c, m) {
  let s = 0;
  for (let i = -1; (b.length - 1) > i; i++) {
    if (++steps > 40) break;
    c[i] = (a[i - 1] + a[i] + a[i + 1]) / 3;
  }
  return s;
}
function f2_1_0_1(a, b, c, m) {
  let s = 0;
  for (let i = 0; (a.length - 1) > i; i++) {
    if (++steps > 40) break;
    c[i] = (a[i - 1] + a[i] + a[i + 1]) / 3;
  }
  return s;
}
function f2_1_1_0(a, b, c, m) {
  let s = 0;
  for (let i = 0; i < (a.length - 2); i++) {
    if (++steps > 40) break;
    c[i] = (a[i - 1] + a[i] + a[i + 1]) / 3;
  }
  return s;
}
function f2_1_2_1(a, b, c, m) {
  let s = 0;
  for (let i = 0; (a.length + 1) > i; i++) {
    if (++steps > 40) break;
    c[i] = (a[i - 1] + a[i] + a[i + 1]) / 3;
  }
  return s;
}
function f2_1_3_0(a, b, c, m) {
  let s = 0;
  for (let i = 0; i < (a.length - n); i++) {
    if (++steps > 40) break;
    c[i] = (a[i - 1] + a[i] + a[i + 1]) / 3;
  }
  return s;
}
function f2_1_4_1(a, b, c, m) {
  let s = 0;
  for (let i = 0; (m - 1) > i; i++) {
    if (++steps > 40) break;
    c[i] = (a[i - 1] + a[i] + a[i + 1]) / 3;
  }
  return s;
}
function f2_1_5_0(a, b, c, m) {
  let s = 0;
  for (let i = 0; i < (b.length - 1); i++) {
    if (++steps > 40) break;
    c[i] = (a[i - 1] + a[i] + a[i + 1]) / 3;
  }
  return s;
}
function f2_2_0_0(a, b, c, m) {
  let s = 0;
  for (let i = 1; i < (a.length - 1); i++) {
    if (++steps > 40) break;
    c[i] = (a[i - 1] + a[i] + a[i + 1]) / 3;
  }
  return s;
}
function f2_2_1_1(a, b, c, m) {
  let s = 0;
  for (let i = 1; (a.length - 2) > i; i++) {
    if (++steps > 40) break;
    c[i] = (a[i - 1] + a[i] + a[i + 1]) / 3;
  }
  return s;
}
function f2_2_2_0(a, b, c, m) {
  let s = 0;
  for (let i = 1; i < (a.length + 1); i++) {
    if (++steps > 40) break;
    c[i] = (a[i - 1] + a[i] + a[i + 1]) / 3;
  }
  return s;
}
function f2_2_3_1(a, b, c, m) {
  let s = 0;
  for (let i = 1; (a.length - n) > i; i++) {
    if (++steps > 40) break;
    c[i] = (a[i - 1] + a[i] + a[i + 1]) / 3;
  }
  return s;
}
function f2_2_4_0(a, b, c, m) {
  let s = 0;
  for (let i = 1; i < (m - 1); i++) {
    if (++steps > 40) break;
    c[i] = (a[i - 1] + a[i] + a[i + 1]) / 3;
  }
  return s;
}
function f2_2_5_1(a, b, c, m) {
  let s = 0;
  for (let i = 1; (b.length - 1) > i; i++) {
    if (++steps > 40) break;
    c[i] = (a[i - 1] + a[i] + a[i + 1]) / 3;
  }
  return s;
}
function f3_0_0_1(a, b, c, m) {
  let s = 0;
  for (let i = -1; (a.length - 1) > i; i++) {
    if (++steps > 40) break;
    a[i] = a[i + 1] * 0.5 + 1;
  }
  return s;
}
function f3_0_1_0(a, b, c, m) {
  let s = 0;
  for (let i = -1; i < (a.length - 2); i++) {
    if (++steps > 40) break;
    a[i] = a[i + 1] * 0.5 + 1;
  }
  return s;
}
function f3_0_2_1(a, b, c, m) {
  let s = 0;
  for (let i = -1; (a.length + 1) > i; i++) {
    if (++steps > 40) break;
    a[i] = a[i + 1] * 0.5 + 1;
  }
  return s;
}
function f3_0_3_0(a, b, c, m) {
  let s = 0;
  for (let i = -1; i < (a.length - n); i++) {
    if (++steps > 40) break;
    a[i] = a[i + 1] * 0.5 + 1;
  }
  return s;
}
function f3_0_4_1(a, b, c, m) {
  let s = 0;
  for (let i = -1; (m - 1) > i; i++) {
    if (++steps > 40) break;
    a[i] = a[i + 1] * 0.5 + 1;
  }
  return s;
}
function f3_0_5_0(a, b, c, m) {
  let s = 0;
  for (let i = -1; i < (b.length - 1); i++) {
    if (++steps > 40) break;
    a[i] = a[i + 1] * 0.5 + 1;
  }
  return s;
}
function f3_1_0_0(a, b, c, m) {
  let s = 0;
  for (let i = 0; i < (a.length - 1); i++) {
    if (++steps > 40) break;
    a[i] = a[i + 1] * 0.5 + 1;
  }
  return s;
}
function f3_1_1_1(a, b, c, m) {
  let s = 0;
  for (let i = 0; (a.length - 2) > i; i++) {
    if (++steps > 40) break;
    a[i] = a[i + 1] * 0.5 + 1;
  }
  return s;
}
function f3_1_2_0(a, b, c, m) {
  let s = 0;
  for (let i = 0; i < (a.length + 1); i++) {
    if (++steps > 40) break;
    a[i] = a[i + 1] * 0.5 + 1;
  }
  return s;
}
function f3_1_3_1(a, b, c, m) {
  let s = 0;
  for (let i = 0; (a.length - n) > i; i++) {
    if (++steps > 40) break;
    a[i] = a[i + 1] * 0.5 + 1;
  }
  return s;
}
function f3_1_4_0(a, b, c, m) {
  let s = 0;
  for (let i = 0; i < (m - 1); i++) {
    if (++steps > 40) break;
    a[i] = a[i + 1] * 0.5 + 1;
  }
  return s;
}
function f3_1_5_1(a, b, c, m) {
  let s = 0;
  for (let i = 0; (b.length - 1) > i; i++) {
    if (++steps > 40) break;
    a[i] = a[i + 1] * 0.5 + 1;
  }
  return s;
}
function f3_2_0_1(a, b, c, m) {
  let s = 0;
  for (let i = 1; (a.length - 1) > i; i++) {
    if (++steps > 40) break;
    a[i] = a[i + 1] * 0.5 + 1;
  }
  return s;
}
function f3_2_1_0(a, b, c, m) {
  let s = 0;
  for (let i = 1; i < (a.length - 2); i++) {
    if (++steps > 40) break;
    a[i] = a[i + 1] * 0.5 + 1;
  }
  return s;
}
function f3_2_2_1(a, b, c, m) {
  let s = 0;
  for (let i = 1; (a.length + 1) > i; i++) {
    if (++steps > 40) break;
    a[i] = a[i + 1] * 0.5 + 1;
  }
  return s;
}
function f3_2_3_0(a, b, c, m) {
  let s = 0;
  for (let i = 1; i < (a.length - n); i++) {
    if (++steps > 40) break;
    a[i] = a[i + 1] * 0.5 + 1;
  }
  return s;
}
function f3_2_4_1(a, b, c, m) {
  let s = 0;
  for (let i = 1; (m - 1) > i; i++) {
    if (++steps > 40) break;
    a[i] = a[i + 1] * 0.5 + 1;
  }
  return s;
}
function f3_2_5_0(a, b, c, m) {
  let s = 0;
  for (let i = 1; i < (b.length - 1); i++) {
    if (++steps > 40) break;
    a[i] = a[i + 1] * 0.5 + 1;
  }
  return s;
}
function f4_0_0_0(a, b, c, m) {
  let s = 0;
  for (let i = -1; i < (a.length - 1); i++) {
    if (++steps > 40) break;
    if (a[i] > a[i + 1]) { const t = a[i]; a[i] = a[i + 1]; a[i + 1] = t; s++; }
  }
  return s;
}
function f4_0_1_1(a, b, c, m) {
  let s = 0;
  for (let i = -1; (a.length - 2) > i; i++) {
    if (++steps > 40) break;
    if (a[i] > a[i + 1]) { const t = a[i]; a[i] = a[i + 1]; a[i + 1] = t; s++; }
  }
  return s;
}
function f4_0_2_0(a, b, c, m) {
  let s = 0;
  for (let i = -1; i < (a.length + 1); i++) {
    if (++steps > 40) break;
    if (a[i] > a[i + 1]) { const t = a[i]; a[i] = a[i + 1]; a[i + 1] = t; s++; }
  }
  return s;
}
function f4_0_3_1(a, b, c, m) {
  let s = 0;
  for (let i = -1; (a.length - n) > i; i++) {
    if (++steps > 40) break;
    if (a[i] > a[i + 1]) { const t = a[i]; a[i] = a[i + 1]; a[i + 1] = t; s++; }
  }
  return s;
}
function f4_0_4_0(a, b, c, m) {
  let s = 0;
  for (let i = -1; i < (m - 1); i++) {
    if (++steps > 40) break;
    if (a[i] > a[i + 1]) { const t = a[i]; a[i] = a[i + 1]; a[i + 1] = t; s++; }
  }
  return s;
}
function f4_0_5_1(a, b, c, m) {
  let s = 0;
  for (let i = -1; (b.length - 1) > i; i++) {
    if (++steps > 40) break;
    if (a[i] > a[i + 1]) { const t = a[i]; a[i] = a[i + 1]; a[i + 1] = t; s++; }
  }
  return s;
}
function f4_1_0_1(a, b, c, m) {
  let s = 0;
  for (let i = 0; (a.length - 1) > i; i++) {
    if (++steps > 40) break;
    if (a[i] > a[i + 1]) { const t = a[i]; a[i] = a[i + 1]; a[i + 1] = t; s++; }
  }
  return s;
}
function f4_1_1_0(a, b, c, m) {
  let s = 0;
  for (let i = 0; i < (a.length - 2); i++) {
    if (++steps > 40) break;
    if (a[i] > a[i + 1]) { const t = a[i]; a[i] = a[i + 1]; a[i + 1] = t; s++; }
  }
  return s;
}
function f4_1_2_1(a, b, c, m) {
  let s = 0;
  for (let i = 0; (a.length + 1) > i; i++) {
    if (++steps > 40) break;
    if (a[i] > a[i + 1]) { const t = a[i]; a[i] = a[i + 1]; a[i + 1] = t; s++; }
  }
  return s;
}
function f4_1_3_0(a, b, c, m) {
  let s = 0;
  for (let i = 0; i < (a.length - n); i++) {
    if (++steps > 40) break;
    if (a[i] > a[i + 1]) { const t = a[i]; a[i] = a[i + 1]; a[i + 1] = t; s++; }
  }
  return s;
}
function f4_1_4_1(a, b, c, m) {
  let s = 0;
  for (let i = 0; (m - 1) > i; i++) {
    if (++steps > 40) break;
    if (a[i] > a[i + 1]) { const t = a[i]; a[i] = a[i + 1]; a[i + 1] = t; s++; }
  }
  return s;
}
function f4_1_5_0(a, b, c, m) {
  let s = 0;
  for (let i = 0; i < (b.length - 1); i++) {
    if (++steps > 40) break;
    if (a[i] > a[i + 1]) { const t = a[i]; a[i] = a[i + 1]; a[i + 1] = t; s++; }
  }
  return s;
}
function f4_2_0_0(a, b, c, m) {
  let s = 0;
  for (let i = 1; i < (a.length - 1); i++) {
    if (++steps > 40) break;
    if (a[i] > a[i + 1]) { const t = a[i]; a[i] = a[i + 1]; a[i + 1] = t; s++; }
  }
  return s;
}
function f4_2_1_1(a, b, c, m) {
  let s = 0;
  for (let i = 1; (a.length - 2) > i; i++) {
    if (++steps > 40) break;
    if (a[i] > a[i + 1]) { const t = a[i]; a[i] = a[i + 1]; a[i + 1] = t; s++; }
  }
  return s;
}
function f4_2_2_0(a, b, c, m) {
  let s = 0;
  for (let i = 1; i < (a.length + 1); i++) {
    if (++steps > 40) break;
    if (a[i] > a[i + 1]) { const t = a[i]; a[i] = a[i + 1]; a[i + 1] = t; s++; }
  }
  return s;
}
function f4_2_3_1(a, b, c, m) {
  let s = 0;
  for (let i = 1; (a.length - n) > i; i++) {
    if (++steps > 40) break;
    if (a[i] > a[i + 1]) { const t = a[i]; a[i] = a[i + 1]; a[i + 1] = t; s++; }
  }
  return s;
}
function f4_2_4_0(a, b, c, m) {
  let s = 0;
  for (let i = 1; i < (m - 1); i++) {
    if (++steps > 40) break;
    if (a[i] > a[i + 1]) { const t = a[i]; a[i] = a[i + 1]; a[i + 1] = t; s++; }
  }
  return s;
}
function f4_2_5_1(a, b, c, m) {
  let s = 0;
  for (let i = 1; (b.length - 1) > i; i++) {
    if (++steps > 40) break;
    if (a[i] > a[i + 1]) { const t = a[i]; a[i] = a[i + 1]; a[i + 1] = t; s++; }
  }
  return s;
}
function f5_0_0_1(a, b, c, m) {
  let s = 0;
  for (let i = -1; (a.length - 1) > i; i++) {
    if (++steps > 40) break;
    s += a[i + 1]; if (i === n) a.length = 2;
  }
  return s;
}
function f5_0_1_0(a, b, c, m) {
  let s = 0;
  for (let i = -1; i < (a.length - 2); i++) {
    if (++steps > 40) break;
    s += a[i + 1]; if (i === n) a.length = 2;
  }
  return s;
}
function f5_0_2_1(a, b, c, m) {
  let s = 0;
  for (let i = -1; (a.length + 1) > i; i++) {
    if (++steps > 40) break;
    s += a[i + 1]; if (i === n) a.length = 2;
  }
  return s;
}
function f5_0_3_0(a, b, c, m) {
  let s = 0;
  for (let i = -1; i < (a.length - n); i++) {
    if (++steps > 40) break;
    s += a[i + 1]; if (i === n) a.length = 2;
  }
  return s;
}
function f5_0_4_1(a, b, c, m) {
  let s = 0;
  for (let i = -1; (m - 1) > i; i++) {
    if (++steps > 40) break;
    s += a[i + 1]; if (i === n) a.length = 2;
  }
  return s;
}
function f5_0_5_0(a, b, c, m) {
  let s = 0;
  for (let i = -1; i < (b.length - 1); i++) {
    if (++steps > 40) break;
    s += a[i + 1]; if (i === n) a.length = 2;
  }
  return s;
}
function f5_1_0_0(a, b, c, m) {
  let s = 0;
  for (let i = 0; i < (a.length - 1); i++) {
    if (++steps > 40) break;
    s += a[i + 1]; if (i === n) a.length = 2;
  }
  return s;
}
function f5_1_1_1(a, b, c, m) {
  let s = 0;
  for (let i = 0; (a.length - 2) > i; i++) {
    if (++steps > 40) break;
    s += a[i + 1]; if (i === n) a.length = 2;
  }
  return s;
}
function f5_1_2_0(a, b, c, m) {
  let s = 0;
  for (let i = 0; i < (a.length + 1); i++) {
    if (++steps > 40) break;
    s += a[i + 1]; if (i === n) a.length = 2;
  }
  return s;
}
function f5_1_3_1(a, b, c, m) {
  let s = 0;
  for (let i = 0; (a.length - n) > i; i++) {
    if (++steps > 40) break;
    s += a[i + 1]; if (i === n) a.length = 2;
  }
  return s;
}
function f5_1_4_0(a, b, c, m) {
  let s = 0;
  for (let i = 0; i < (m - 1); i++) {
    if (++steps > 40) break;
    s += a[i + 1]; if (i === n) a.length = 2;
  }
  return s;
}
function f5_1_5_1(a, b, c, m) {
  let s = 0;
  for (let i = 0; (b.length - 1) > i; i++) {
    if (++steps > 40) break;
    s += a[i + 1]; if (i === n) a.length = 2;
  }
  return s;
}
function f5_2_0_1(a, b, c, m) {
  let s = 0;
  for (let i = 1; (a.length - 1) > i; i++) {
    if (++steps > 40) break;
    s += a[i + 1]; if (i === n) a.length = 2;
  }
  return s;
}
function f5_2_1_0(a, b, c, m) {
  let s = 0;
  for (let i = 1; i < (a.length - 2); i++) {
    if (++steps > 40) break;
    s += a[i + 1]; if (i === n) a.length = 2;
  }
  return s;
}
function f5_2_2_1(a, b, c, m) {
  let s = 0;
  for (let i = 1; (a.length + 1) > i; i++) {
    if (++steps > 40) break;
    s += a[i + 1]; if (i === n) a.length = 2;
  }
  return s;
}
function f5_2_3_0(a, b, c, m) {
  let s = 0;
  for (let i = 1; i < (a.length - n); i++) {
    if (++steps > 40) break;
    s += a[i + 1]; if (i === n) a.length = 2;
  }
  return s;
}
function f5_2_4_1(a, b, c, m) {
  let s = 0;
  for (let i = 1; (m - 1) > i; i++) {
    if (++steps > 40) break;
    s += a[i + 1]; if (i === n) a.length = 2;
  }
  return s;
}
function f5_2_5_0(a, b, c, m) {
  let s = 0;
  for (let i = 1; i < (b.length - 1); i++) {
    if (++steps > 40) break;
    s += a[i + 1]; if (i === n) a.length = 2;
  }
  return s;
}
function f6_0_0_0(a, b, c, m) {
  let s = 0;
  for (let i = -1; i < (a.length - 1); i++) {
    if (++steps > 40) break;
    s += a[i + 1] || 0; if (a.length < 9) a.push(i);
  }
  return s;
}
function f6_0_1_1(a, b, c, m) {
  let s = 0;
  for (let i = -1; (a.length - 2) > i; i++) {
    if (++steps > 40) break;
    s += a[i + 1] || 0; if (a.length < 9) a.push(i);
  }
  return s;
}
function f6_0_2_0(a, b, c, m) {
  let s = 0;
  for (let i = -1; i < (a.length + 1); i++) {
    if (++steps > 40) break;
    s += a[i + 1] || 0; if (a.length < 9) a.push(i);
  }
  return s;
}
function f6_0_3_1(a, b, c, m) {
  let s = 0;
  for (let i = -1; (a.length - n) > i; i++) {
    if (++steps > 40) break;
    s += a[i + 1] || 0; if (a.length < 9) a.push(i);
  }
  return s;
}
function f6_0_4_0(a, b, c, m) {
  let s = 0;
  for (let i = -1; i < (m - 1); i++) {
    if (++steps > 40) break;
    s += a[i + 1] || 0; if (a.length < 9) a.push(i);
  }
  return s;
}
function f6_0_5_1(a, b, c, m) {
  let s = 0;
  for (let i = -1; (b.length - 1) > i; i++) {
    if (++steps > 40) break;
    s += a[i + 1] || 0; if (a.length < 9) a.push(i);
  }
  return s;
}
function f6_1_0_1(a, b, c, m) {
  let s = 0;
  for (let i = 0; (a.length - 1) > i; i++) {
    if (++steps > 40) break;
    s += a[i + 1] || 0; if (a.length < 9) a.push(i);
  }
  return s;
}
function f6_1_1_0(a, b, c, m) {
  let s = 0;
  for (let i = 0; i < (a.length - 2); i++) {
    if (++steps > 40) break;
    s += a[i + 1] || 0; if (a.length < 9) a.push(i);
  }
  return s;
}
function f6_1_2_1(a, b, c, m) {
  let s = 0;
  for (let i = 0; (a.length + 1) > i; i++) {
    if (++steps > 40) break;
    s += a[i + 1] || 0; if (a.length < 9) a.push(i);
  }
  return s;
}
function f6_1_3_0(a, b, c, m) {
  let s = 0;
  for (let i = 0; i < (a.length - n); i++) {
    if (++steps > 40) break;
    s += a[i + 1] || 0; if (a.length < 9) a.push(i);
  }
  return s;
}
function f6_1_4_1(a, b, c, m) {
  let s = 0;
  for (let i = 0; (m - 1) > i; i++) {
    if (++steps > 40) break;
    s += a[i + 1] || 0; if (a.length < 9) a.push(i);
  }
  return s;
}
function f6_1_5_0(a, b, c, m) {
  let s = 0;
  for (let i = 0; i < (b.length - 1); i++) {
    if (++steps > 40) break;
    s += a[i + 1] || 0; if (a.length < 9) a.push(i);
  }
  return s;
}
function f6_2_0_0(a, b, c, m) {
  let s = 0;
  for (let i = 1; i < (a.length - 1); i++) {
    if (++steps > 40) break;
    s += a[i + 1] || 0; if (a.length < 9) a.push(i);
  }
  return s;
}
function f6_2_1_1(a, b, c, m) {
  let s = 0;
  for (let i = 1; (a.length - 2) > i; i++) {
    if (++steps > 40) break;
    s += a[i + 1] || 0; if (a.length < 9) a.push(i);
  }
  return s;
}
function f6_2_2_0(a, b, c, m) {
  let s = 0;
  for (let i = 1; i < (a.length + 1); i++) {
    if (++steps > 40) break;
    s += a[i + 1] || 0; if (a.length < 9) a.push(i);
  }
  return s;
}
function f6_2_3_1(a, b, c, m) {
  let s = 0;
  for (let i = 1; (a.length - n) > i; i++) {
    if (++steps > 40) break;
    s += a[i + 1] || 0; if (a.length < 9) a.push(i);
  }
  return s;
}
function f6_2_4_0(a, b, c, m) {
  let s = 0;
  for (let i = 1; i < (m - 1); i++) {
    if (++steps > 40) break;
    s += a[i + 1] || 0; if (a.length < 9) a.push(i);
  }
  return s;
}
function f6_2_5_1(a, b, c, m) {
  let s = 0;
  for (let i = 1; (b.length - 1) > i; i++) {
    if (++steps > 40) break;
    s += a[i + 1] || 0; if (a.length < 9) a.push(i);
  }
  return s;
}
function f7_0_0_1(a, b, c, m) {
  let s = 0;
  for (let i = -1; (a.length - 1) > i; i++) {
    if (++steps > 40) break;
    s += a[i + 1] - change(a, i);
  }
  return s;
}
function f7_0_1_0(a, b, c, m) {
  let s = 0;
  for (let i = -1; i < (a.length - 2); i++) {
    if (++steps > 40) break;
    s += a[i + 1] - change(a, i);
  }
  return s;
}
function f7_0_2_1(a, b, c, m) {
  let s = 0;
  for (let i = -1; (a.length + 1) > i; i++) {
    if (++steps > 40) break;
    s += a[i + 1] - change(a, i);
  }
  return s;
}
function f7_0_3_0(a, b, c, m) {
  let s = 0;
  for (let i = -1; i < (a.length - n); i++) {
    if (++steps > 40) break;
    s += a[i + 1] - change(a, i);
  }
  return s;
}
function f7_0_4_1(a, b, c, m) {
  let s = 0;
  for (let i = -1; (m - 1) > i; i++) {
    if (++steps > 40) break;
    s += a[i + 1] - change(a, i);
  }
  return s;
}
function f7_0_5_0(a, b, c, m) {
  let s = 0;
  for (let i = -1; i < (b.length - 1); i++) {
    if (++steps > 40) break;
    s += a[i + 1] - change(a, i);
  }
  return s;
}
function f7_1_0_0(a, b, c, m) {
  let s = 0;
  for (let i = 0; i < (a.length - 1); i++) {
    if (++steps > 40) break;
    s += a[i + 1] - change(a, i);
  }
  return s;
}
function f7_1_1_1(a, b, c, m) {
  let s = 0;
  for (let i = 0; (a.length - 2) > i; i++) {
    if (++steps > 40) break;
    s += a[i + 1] - change(a, i);
  }
  return s;
}
function f7_1_2_0(a, b, c, m) {
  let s = 0;
  for (let i = 0; i < (a.length + 1); i++) {
    if (++steps > 40) break;
    s += a[i + 1] - change(a, i);
  }
  return s;
}
function f7_1_3_1(a, b, c, m) {
  let s = 0;
  for (let i = 0; (a.length - n) > i; i++) {
    if (++steps > 40) break;
    s += a[i + 1] - change(a, i);
  }
  return s;
}
function f7_1_4_0(a, b, c, m) {
  let s = 0;
  for (let i = 0; i < (m - 1); i++) {
    if (++steps > 40) break;
    s += a[i + 1] - change(a, i);
  }
  return s;
}
function f7_1_5_1(a, b, c, m) {
  let s = 0;
  for (let i = 0; (b.length - 1) > i; i++) {
    if (++steps > 40) break;
    s += a[i + 1] - change(a, i);
  }
  return s;
}
function f7_2_0_1(a, b, c, m) {
  let s = 0;
  for (let i = 1; (a.length - 1) > i; i++) {
    if (++steps > 40) break;
    s += a[i + 1] - change(a, i);
  }
  return s;
}
function f7_2_1_0(a, b, c, m) {
  let s = 0;
  for (let i = 1; i < (a.length - 2); i++) {
    if (++steps > 40) break;
    s += a[i + 1] - change(a, i);
  }
  return s;
}
function f7_2_2_1(a, b, c, m) {
  let s = 0;
  for (let i = 1; (a.length + 1) > i; i++) {
    if (++steps > 40) break;
    s += a[i + 1] - change(a, i);
  }
  return s;
}
function f7_2_3_0(a, b, c, m) {
  let s = 0;
  for (let i = 1; i < (a.length - n); i++) {
    if (++steps > 40) break;
    s += a[i + 1] - change(a, i);
  }
  return s;
}
function f7_2_4_1(a, b, c, m) {
  let s = 0;
  for (let i = 1; (m - 1) > i; i++) {
    if (++steps > 40) break;
    s += a[i + 1] - change(a, i);
  }
  return s;
}
function f7_2_5_0(a, b, c, m) {
  let s = 0;
  for (let i = 1; i < (b.length - 1); i++) {
    if (++steps > 40) break;
    s += a[i + 1] - change(a, i);
  }
  return s;
}
function f8_0_0_0(a, b, c, m) {
  let s = 0;
  for (let i = -1; i < (a.length - 1); i++) {
    if (++steps > 40) break;
    s += a[i + 1]; i++;
  }
  return s;
}
function f8_0_1_1(a, b, c, m) {
  let s = 0;
  for (let i = -1; (a.length - 2) > i; i++) {
    if (++steps > 40) break;
    s += a[i + 1]; i++;
  }
  return s;
}
function f8_0_2_0(a, b, c, m) {
  let s = 0;
  for (let i = -1; i < (a.length + 1); i++) {
    if (++steps > 40) break;
    s += a[i + 1]; i++;
  }
  return s;
}
function f8_0_3_1(a, b, c, m) {
  let s = 0;
  for (let i = -1; (a.length - n) > i; i++) {
    if (++steps > 40) break;
    s += a[i + 1]; i++;
  }
  return s;
}
function f8_0_4_0(a, b, c, m) {
  let s = 0;
  for (let i = -1; i < (m - 1); i++) {
    if (++steps > 40) break;
    s += a[i + 1]; i++;
  }
  return s;
}
function f8_0_5_1(a, b, c, m) {
  let s = 0;
  for (let i = -1; (b.length - 1) > i; i++) {
    if (++steps > 40) break;
    s += a[i + 1]; i++;
  }
  return s;
}
function f8_1_0_1(a, b, c, m) {
  let s = 0;
  for (let i = 0; (a.length - 1) > i; i++) {
    if (++steps > 40) break;
    s += a[i + 1]; i++;
  }
  return s;
}
function f8_1_1_0(a, b, c, m) {
  let s = 0;
  for (let i = 0; i < (a.length - 2); i++) {
    if (++steps > 40) break;
    s += a[i + 1]; i++;
  }
  return s;
}
function f8_1_2_1(a, b, c, m) {
  let s = 0;
  for (let i = 0; (a.length + 1) > i; i++) {
    if (++steps > 40) break;
    s += a[i + 1]; i++;
  }
  return s;
}
function f8_1_3_0(a, b, c, m) {
  let s = 0;
  for (let i = 0; i < (a.length - n); i++) {
    if (++steps > 40) break;
    s += a[i + 1]; i++;
  }
  return s;
}
function f8_1_4_1(a, b, c, m) {
  let s = 0;
  for (let i = 0; (m - 1) > i; i++) {
    if (++steps > 40) break;
    s += a[i + 1]; i++;
  }
  return s;
}
function f8_1_5_0(a, b, c, m) {
  let s = 0;
  for (let i = 0; i < (b.length - 1); i++) {
    if (++steps > 40) break;
    s += a[i + 1]; i++;
  }
  return s;
}
function f8_2_0_0(a, b, c, m) {
  let s = 0;
  for (let i = 1; i < (a.length - 1); i++) {
    if (++steps > 40) break;
    s += a[i + 1]; i++;
  }
  return s;
}
function f8_2_1_1(a, b, c, m) {
  let s = 0;
  for (let i = 1; (a.length - 2) > i; i++) {
    if (++steps > 40) break;
    s += a[i + 1]; i++;
  }
  return s;
}
function f8_2_2_0(a, b, c, m) {
  let s = 0;
  for (let i = 1; i < (a.length + 1); i++) {
    if (++steps > 40) break;
    s += a[i + 1]; i++;
  }
  return s;
}
function f8_2_3_1(a, b, c, m) {
  let s = 0;
  for (let i = 1; (a.length - n) > i; i++) {
    if (++steps > 40) break;
    s += a[i + 1]; i++;
  }
  return s;
}
function f8_2_4_0(a, b, c, m) {
  let s = 0;
  for (let i = 1; i < (m - 1); i++) {
    if (++steps > 40) break;
    s += a[i + 1]; i++;
  }
  return s;
}
function f8_2_5_1(a, b, c, m) {
  let s = 0;
  for (let i = 1; (b.length - 1) > i; i++) {
    if (++steps > 40) break;
    s += a[i + 1]; i++;
  }
  return s;
}
function f9_0_0_1(a, b, c, m) {
  let s = 0;
  for (let i = -1; (a.length - 1) > i; i++) {
    if (++steps > 40) break;
    for (let j = i; j < a.length - 1; j++) s += a[j + 1] - a[i];
  }
  return s;
}
function f9_0_1_0(a, b, c, m) {
  let s = 0;
  for (let i = -1; i < (a.length - 2); i++) {
    if (++steps > 40) break;
    for (let j = i; j < a.length - 1; j++) s += a[j + 1] - a[i];
  }
  return s;
}
function f9_0_2_1(a, b, c, m) {
  let s = 0;
  for (let i = -1; (a.length + 1) > i; i++) {
    if (++steps > 40) break;
    for (let j = i; j < a.length - 1; j++) s += a[j + 1] - a[i];
  }
  return s;
}
function f9_0_3_0(a, b, c, m) {
  let s = 0;
  for (let i = -1; i < (a.length - n); i++) {
    if (++steps > 40) break;
    for (let j = i; j < a.length - 1; j++) s += a[j + 1] - a[i];
  }
  return s;
}
function f9_0_4_1(a, b, c, m) {
  let s = 0;
  for (let i = -1; (m - 1) > i; i++) {
    if (++steps > 40) break;
    for (let j = i; j < a.length - 1; j++) s += a[j + 1] - a[i];
  }
  return s;
}
function f9_0_5_0(a, b, c, m) {
  let s = 0;
  for (let i = -1; i < (b.length - 1); i++) {
    if (++steps > 40) break;
    for (let j = i; j < a.length - 1; j++) s += a[j + 1] - a[i];
  }
  return s;
}
function f9_1_0_0(a, b, c, m) {
  let s = 0;
  for (let i = 0; i < (a.length - 1); i++) {
    if (++steps > 40) break;
    for (let j = i; j < a.length - 1; j++) s += a[j + 1] - a[i];
  }
  return s;
}
function f9_1_1_1(a, b, c, m) {
  let s = 0;
  for (let i = 0; (a.length - 2) > i; i++) {
    if (++steps > 40) break;
    for (let j = i; j < a.length - 1; j++) s += a[j + 1] - a[i];
  }
  return s;
}
function f9_1_2_0(a, b, c, m) {
  let s = 0;
  for (let i = 0; i < (a.length + 1); i++) {
    if (++steps > 40) break;
    for (let j = i; j < a.length - 1; j++) s += a[j + 1] - a[i];
  }
  return s;
}
function f9_1_3_1(a, b, c, m) {
  let s = 0;
  for (let i = 0; (a.length - n) > i; i++) {
    if (++steps > 40) break;
    for (let j = i; j < a.length - 1; j++) s += a[j + 1] - a[i];
  }
  return s;
}
function f9_1_4_0(a, b, c, m) {
  let s = 0;
  for (let i = 0; i < (m - 1); i++) {
    if (++steps > 40) break;
    for (let j = i; j < a.length - 1; j++) s += a[j + 1] - a[i];
  }
  return s;
}
function f9_1_5_1(a, b, c, m) {
  let s = 0;
  for (let i = 0; (b.length - 1) > i; i++) {
    if (++steps > 40) break;
    for (let j = i; j < a.length - 1; j++) s += a[j + 1] - a[i];
  }
  return s;
}
function f9_2_0_1(a, b, c, m) {
  let s = 0;
  for (let i = 1; (a.length - 1) > i; i++) {
    if (++steps > 40) break;
    for (let j = i; j < a.length - 1; j++) s += a[j + 1] - a[i];
  }
  return s;
}
function f9_2_1_0(a, b, c, m) {
  let s = 0;
  for (let i = 1; i < (a.length - 2); i++) {
    if (++steps > 40) break;
    for (let j = i; j < a.length - 1; j++) s += a[j + 1] - a[i];
  }
  return s;
}
function f9_2_2_1(a, b, c, m) {
  let s = 0;
  for (let i = 1; (a.length + 1) > i; i++) {
    if (++steps > 40) break;
    for (let j = i; j < a.length - 1; j++) s += a[j + 1] - a[i];
  }
  return s;
}
function f9_2_3_0(a, b, c, m) {
  let s = 0;
  for (let i = 1; i < (a.length - n); i++) {
    if (++steps > 40) break;
    for (let j = i; j < a.length - 1; j++) s += a[j + 1] - a[i];
  }
  return s;
}
function f9_2_4_1(a, b, c, m) {
  let s = 0;
  for (let i = 1; (m - 1) > i; i++) {
    if (++steps > 40) break;
    for (let j = i; j < a.length - 1; j++) s += a[j + 1] - a[i];
  }
  return s;
}
function f9_2_5_0(a, b, c, m) {
  let s = 0;
  for (let i = 1; i < (b.length - 1); i++) {
    if (++steps > 40) break;
    for (let j = i; j < a.length - 1; j++) s += a[j + 1] - a[i];
  }
  return s;
}
let seen = 0, steps = 0, changes = 0;
class Own extends Array {}
const n = JSON.parse("3"), log = [];
function change(a, i) {
  changes++;
  if (changes % 5 === 0) a.length = 2;
  if (changes % 7 === 0) delete a[i];
  return a[i];
}
function show(list) {
  if (list === null || typeof list !== "object") return String(list);
  const all = [];
  for (let i = 0; i < Math.min(list.length >>> 0, 14); i++) all.push(i in list ? (Object.is(list[i], -0) ? "-0" : typeof list[i] === "object" ? "{}" : String(list[i])) : "hole");
  return list.length + ":" + all.join();
}
const kinds = {
  "doubles": () => [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5],
  "ints": () => [1, 2, 3, 4, 5, 6, 7, 8],
  "one": () => [1.5],
  "two": () => [1.5, 2.5],
  "three": () => [1.5, 2, 3],
  "none": () => [],
  "holes": () => [0.5, , 2.5, , , 5.5, 6.5],
  "mixed": () => [1, "2", null, 4.5, undefined, 6, 7],
  "objects": () => [{ valueOf() { seen++; return 2; } }, 2.5, 3],
  "made": () => Array.from({ length: n + 6 }, (_, i) => i + 0.25),
  "room": () => new Array(n + 4),
  "far": () => (() => { const list = [1.5, 2.5]; list[n + 60] = 3; return list; })(),
  "own prototype": () => (() => { const list = [1.5, , 3.5]; Object.setPrototypeOf(list, Object.create(Array.prototype, { 1: { value: 9.5, writable: true }, 3: { get() { seen++; return 7; } } })); return list; })(),
  "heir": () => Own.from([1.5, 2.5, 3.5, 4.5]),
  "frozen": () => Object.freeze([1.5, 2.5, 3.5, 4.5]),
};
const others = {
  "view": () => new Float64Array([0.5, 1.5, 2.5, 3.5, 4.5]),
  "bytes": () => new Uint8Array([1, 2, 3, 4, 5, 6]),
  "text": () => "01234",
  "like": () => ({ length: 5, 0: 1.5, 1: 2, 3: 4 }),
  "no view": () => new Int32Array(0),
  "resizable": () => new Float64Array(new ArrayBuffer(40, { maxByteLength: 80 })),
};
const functions = [
  ["reads from -1, i < a.length - 1", f0_0_0_0],
  ["reads from -1, a.length - 2 > i", f0_0_1_1],
  ["reads from -1, i < a.length + 1", f0_0_2_0],
  ["reads from -1, a.length - n > i", f0_0_3_1],
  ["reads from -1, i < m - 1", f0_0_4_0],
  ["reads from -1, b.length - 1 > i", f0_0_5_1],
  ["reads from 0, a.length - 1 > i", f0_1_0_1],
  ["reads from 0, i < a.length - 2", f0_1_1_0],
  ["reads from 0, a.length + 1 > i", f0_1_2_1],
  ["reads from 0, i < a.length - n", f0_1_3_0],
  ["reads from 0, m - 1 > i", f0_1_4_1],
  ["reads from 0, i < b.length - 1", f0_1_5_0],
  ["reads from 1, i < a.length - 1", f0_2_0_0],
  ["reads from 1, a.length - 2 > i", f0_2_1_1],
  ["reads from 1, i < a.length + 1", f0_2_2_0],
  ["reads from 1, a.length - n > i", f0_2_3_1],
  ["reads from 1, i < m - 1", f0_2_4_0],
  ["reads from 1, b.length - 1 > i", f0_2_5_1],
  ["further from -1, a.length - 1 > i", f1_0_0_1],
  ["further from -1, i < a.length - 2", f1_0_1_0],
  ["further from -1, a.length + 1 > i", f1_0_2_1],
  ["further from -1, i < a.length - n", f1_0_3_0],
  ["further from -1, m - 1 > i", f1_0_4_1],
  ["further from -1, i < b.length - 1", f1_0_5_0],
  ["further from 0, i < a.length - 1", f1_1_0_0],
  ["further from 0, a.length - 2 > i", f1_1_1_1],
  ["further from 0, i < a.length + 1", f1_1_2_0],
  ["further from 0, a.length - n > i", f1_1_3_1],
  ["further from 0, i < m - 1", f1_1_4_0],
  ["further from 0, b.length - 1 > i", f1_1_5_1],
  ["further from 1, a.length - 1 > i", f1_2_0_1],
  ["further from 1, i < a.length - 2", f1_2_1_0],
  ["further from 1, a.length + 1 > i", f1_2_2_1],
  ["further from 1, i < a.length - n", f1_2_3_0],
  ["further from 1, m - 1 > i", f1_2_4_1],
  ["further from 1, i < b.length - 1", f1_2_5_0],
  ["stores from -1, i < a.length - 1", f2_0_0_0],
  ["stores from -1, a.length - 2 > i", f2_0_1_1],
  ["stores from -1, i < a.length + 1", f2_0_2_0],
  ["stores from -1, a.length - n > i", f2_0_3_1],
  ["stores from -1, i < m - 1", f2_0_4_0],
  ["stores from -1, b.length - 1 > i", f2_0_5_1],
  ["stores from 0, a.length - 1 > i", f2_1_0_1],
  ["stores from 0, i < a.length - 2", f2_1_1_0],
  ["stores from 0, a.length + 1 > i", f2_1_2_1],
  ["stores from 0, i < a.length - n", f2_1_3_0],
  ["stores from 0, m - 1 > i", f2_1_4_1],
  ["stores from 0, i < b.length - 1", f2_1_5_0],
  ["stores from 1, i < a.length - 1", f2_2_0_0],
  ["stores from 1, a.length - 2 > i", f2_2_1_1],
  ["stores from 1, i < a.length + 1", f2_2_2_0],
  ["stores from 1, a.length - n > i", f2_2_3_1],
  ["stores from 1, i < m - 1", f2_2_4_0],
  ["stores from 1, b.length - 1 > i", f2_2_5_1],
  ["storesIn from -1, a.length - 1 > i", f3_0_0_1],
  ["storesIn from -1, i < a.length - 2", f3_0_1_0],
  ["storesIn from -1, a.length + 1 > i", f3_0_2_1],
  ["storesIn from -1, i < a.length - n", f3_0_3_0],
  ["storesIn from -1, m - 1 > i", f3_0_4_1],
  ["storesIn from -1, i < b.length - 1", f3_0_5_0],
  ["storesIn from 0, i < a.length - 1", f3_1_0_0],
  ["storesIn from 0, a.length - 2 > i", f3_1_1_1],
  ["storesIn from 0, i < a.length + 1", f3_1_2_0],
  ["storesIn from 0, a.length - n > i", f3_1_3_1],
  ["storesIn from 0, i < m - 1", f3_1_4_0],
  ["storesIn from 0, b.length - 1 > i", f3_1_5_1],
  ["storesIn from 1, a.length - 1 > i", f3_2_0_1],
  ["storesIn from 1, i < a.length - 2", f3_2_1_0],
  ["storesIn from 1, a.length + 1 > i", f3_2_2_1],
  ["storesIn from 1, i < a.length - n", f3_2_3_0],
  ["storesIn from 1, m - 1 > i", f3_2_4_1],
  ["storesIn from 1, i < b.length - 1", f3_2_5_0],
  ["swaps from -1, i < a.length - 1", f4_0_0_0],
  ["swaps from -1, a.length - 2 > i", f4_0_1_1],
  ["swaps from -1, i < a.length + 1", f4_0_2_0],
  ["swaps from -1, a.length - n > i", f4_0_3_1],
  ["swaps from -1, i < m - 1", f4_0_4_0],
  ["swaps from -1, b.length - 1 > i", f4_0_5_1],
  ["swaps from 0, a.length - 1 > i", f4_1_0_1],
  ["swaps from 0, i < a.length - 2", f4_1_1_0],
  ["swaps from 0, a.length + 1 > i", f4_1_2_1],
  ["swaps from 0, i < a.length - n", f4_1_3_0],
  ["swaps from 0, m - 1 > i", f4_1_4_1],
  ["swaps from 0, i < b.length - 1", f4_1_5_0],
  ["swaps from 1, i < a.length - 1", f4_2_0_0],
  ["swaps from 1, a.length - 2 > i", f4_2_1_1],
  ["swaps from 1, i < a.length + 1", f4_2_2_0],
  ["swaps from 1, a.length - n > i", f4_2_3_1],
  ["swaps from 1, i < m - 1", f4_2_4_0],
  ["swaps from 1, b.length - 1 > i", f4_2_5_1],
  ["shorter from -1, a.length - 1 > i", f5_0_0_1],
  ["shorter from -1, i < a.length - 2", f5_0_1_0],
  ["shorter from -1, a.length + 1 > i", f5_0_2_1],
  ["shorter from -1, i < a.length - n", f5_0_3_0],
  ["shorter from -1, m - 1 > i", f5_0_4_1],
  ["shorter from -1, i < b.length - 1", f5_0_5_0],
  ["shorter from 0, i < a.length - 1", f5_1_0_0],
  ["shorter from 0, a.length - 2 > i", f5_1_1_1],
  ["shorter from 0, i < a.length + 1", f5_1_2_0],
  ["shorter from 0, a.length - n > i", f5_1_3_1],
  ["shorter from 0, i < m - 1", f5_1_4_0],
  ["shorter from 0, b.length - 1 > i", f5_1_5_1],
  ["shorter from 1, a.length - 1 > i", f5_2_0_1],
  ["shorter from 1, i < a.length - 2", f5_2_1_0],
  ["shorter from 1, a.length + 1 > i", f5_2_2_1],
  ["shorter from 1, i < a.length - n", f5_2_3_0],
  ["shorter from 1, m - 1 > i", f5_2_4_1],
  ["shorter from 1, i < b.length - 1", f5_2_5_0],
  ["pushes from -1, i < a.length - 1", f6_0_0_0],
  ["pushes from -1, a.length - 2 > i", f6_0_1_1],
  ["pushes from -1, i < a.length + 1", f6_0_2_0],
  ["pushes from -1, a.length - n > i", f6_0_3_1],
  ["pushes from -1, i < m - 1", f6_0_4_0],
  ["pushes from -1, b.length - 1 > i", f6_0_5_1],
  ["pushes from 0, a.length - 1 > i", f6_1_0_1],
  ["pushes from 0, i < a.length - 2", f6_1_1_0],
  ["pushes from 0, a.length + 1 > i", f6_1_2_1],
  ["pushes from 0, i < a.length - n", f6_1_3_0],
  ["pushes from 0, m - 1 > i", f6_1_4_1],
  ["pushes from 0, i < b.length - 1", f6_1_5_0],
  ["pushes from 1, i < a.length - 1", f6_2_0_0],
  ["pushes from 1, a.length - 2 > i", f6_2_1_1],
  ["pushes from 1, i < a.length + 1", f6_2_2_0],
  ["pushes from 1, a.length - n > i", f6_2_3_1],
  ["pushes from 1, i < m - 1", f6_2_4_0],
  ["pushes from 1, b.length - 1 > i", f6_2_5_1],
  ["calls from -1, a.length - 1 > i", f7_0_0_1],
  ["calls from -1, i < a.length - 2", f7_0_1_0],
  ["calls from -1, a.length + 1 > i", f7_0_2_1],
  ["calls from -1, i < a.length - n", f7_0_3_0],
  ["calls from -1, m - 1 > i", f7_0_4_1],
  ["calls from -1, i < b.length - 1", f7_0_5_0],
  ["calls from 0, i < a.length - 1", f7_1_0_0],
  ["calls from 0, a.length - 2 > i", f7_1_1_1],
  ["calls from 0, i < a.length + 1", f7_1_2_0],
  ["calls from 0, a.length - n > i", f7_1_3_1],
  ["calls from 0, i < m - 1", f7_1_4_0],
  ["calls from 0, b.length - 1 > i", f7_1_5_1],
  ["calls from 1, a.length - 1 > i", f7_2_0_1],
  ["calls from 1, i < a.length - 2", f7_2_1_0],
  ["calls from 1, a.length + 1 > i", f7_2_2_1],
  ["calls from 1, i < a.length - n", f7_2_3_0],
  ["calls from 1, m - 1 > i", f7_2_4_1],
  ["calls from 1, i < b.length - 1", f7_2_5_0],
  ["steps from -1, i < a.length - 1", f8_0_0_0],
  ["steps from -1, a.length - 2 > i", f8_0_1_1],
  ["steps from -1, i < a.length + 1", f8_0_2_0],
  ["steps from -1, a.length - n > i", f8_0_3_1],
  ["steps from -1, i < m - 1", f8_0_4_0],
  ["steps from -1, b.length - 1 > i", f8_0_5_1],
  ["steps from 0, a.length - 1 > i", f8_1_0_1],
  ["steps from 0, i < a.length - 2", f8_1_1_0],
  ["steps from 0, a.length + 1 > i", f8_1_2_1],
  ["steps from 0, i < a.length - n", f8_1_3_0],
  ["steps from 0, m - 1 > i", f8_1_4_1],
  ["steps from 0, i < b.length - 1", f8_1_5_0],
  ["steps from 1, i < a.length - 1", f8_2_0_0],
  ["steps from 1, a.length - 2 > i", f8_2_1_1],
  ["steps from 1, i < a.length + 1", f8_2_2_0],
  ["steps from 1, a.length - n > i", f8_2_3_1],
  ["steps from 1, i < m - 1", f8_2_4_0],
  ["steps from 1, b.length - 1 > i", f8_2_5_1],
  ["nested from -1, a.length - 1 > i", f9_0_0_1],
  ["nested from -1, i < a.length - 2", f9_0_1_0],
  ["nested from -1, a.length + 1 > i", f9_0_2_1],
  ["nested from -1, i < a.length - n", f9_0_3_0],
  ["nested from -1, m - 1 > i", f9_0_4_1],
  ["nested from -1, i < b.length - 1", f9_0_5_0],
  ["nested from 0, i < a.length - 1", f9_1_0_0],
  ["nested from 0, a.length - 2 > i", f9_1_1_1],
  ["nested from 0, i < a.length + 1", f9_1_2_0],
  ["nested from 0, a.length - n > i", f9_1_3_1],
  ["nested from 0, i < m - 1", f9_1_4_0],
  ["nested from 0, b.length - 1 > i", f9_1_5_1],
  ["nested from 1, a.length - 1 > i", f9_2_0_1],
  ["nested from 1, i < a.length - 2", f9_2_1_0],
  ["nested from 1, a.length + 1 > i", f9_2_2_1],
  ["nested from 1, i < a.length - n", f9_2_3_0],
  ["nested from 1, m - 1 > i", f9_2_4_1],
  ["nested from 1, i < b.length - 1", f9_2_5_0],
];
let numberOfCase = 0;
for (const all of [kinds, others]) {
  for (const kind of Object.keys(all)) {
    for (const [name, run] of functions) {
      if (numberOfCase++ % 2) continue;
      const a = all[kind](), b = [1.5, 2.5, 3.5, 4.5, 5.5], c = [0.5, 0.5, 0.5, 0.5, 0.5, 0.5];
      seen = steps = changes = 0;
      let answer;
      try {
        answer = String(run(a, b, c, a.length));
      } catch (error) {
        answer = error.name;
      }
      log.push(kind + " " + name + ": " + answer + " " + show(a) + " " + show(c) + " " + seen);
    }
  }
}
let sum = 0;
for (const line of log) for (let i = 0; i < line.length; i++) sum = (sum * 31 + line.charCodeAt(i)) | 0;
console.log(log.length, sum);
for (let i = 0; i < log.length; i += 7) console.log(log[i]);
