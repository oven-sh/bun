// STATISTIC: JoinsMeasuredByParts >= 3
// `rgb(${r}, ${g}, ${b})`.length: the digits of integers from 0 up are counted, and no string is made.
const names = ["", "a", "lorem ipsum", "中"];
function colors(n) {
  let s = 0;
  for (let k = 0; k < n; k++) {
    const r = k & 255, g = (k * 3) & 255, b = (k >> 3) & 255;
    s += `rgb(${r}, ${g}, ${b})`.length;
  }
  return s;
}
function pairs(n) {
  let s = 0;
  for (let k = 0; k < n; k++) s += `${k & 16383}:${(k * 7) & 65535}`.length * (k % 3 + 1);
  return s;
}
function named(n) {
  let s = 0;
  for (let k = 0; k < n; k++) s = s * 3 + `${names[k & 3]}#${k & 1023}`.length & 0xffffff;
  return s;
}
function joined(n) {
  let s = 0;
  for (let k = 0; k < n; k++) s += [k & 7, (k * 5) & 4095, k % 100].join("--").length;
  return s;
}
function signed(n) {
  let s = 0;
  for (let k = -n; k < n; k++) s += `${k}/${k & 99999}/${k * 0.5}`.length;
  return s;
}
function edges() {
  const l = [];
  for (const k of [0, 9, 10, 99, 100, 999, 1000, 9999, 10000, 16383]) l.push(`${k & 16383},${(k + 1) & 16383}`.length);
  return l.join();
}
function kept(n) {
  let s = 0, last = "";
  for (let k = 0; k < n; k++) {
    const t = `${k & 63}x${k & 127}`;
    s += t.length;
    if (k % 50 === 0) last += t;
  }
  return s + last;
}
for (const n of [0, 1, 300, 70000]) console.log(colors(n), pairs(n), named(n), joined(n), signed(n % 5000), kept(n % 1000));
console.log(edges());
