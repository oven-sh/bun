const a = [],
  b = [];
for (let i = 0; i < 12; i++) {
  a.push(i + 0.25);
  b.push(i * 7);
}
function mix(s, v) {
  return (s * 33 + v) % 1000000007;
}
function big(a, b, rare) {
  let s = 1;
  let v0 = 0,
    v1 = 0,
    v2 = 0,
    v3 = 0,
    v4 = 0,
    v5 = 0;
  try {
    v0 = b[0];
    while (b !== b) b = [b];
    v1 = a[1];
    while (v2 !== v2) v2 = [v2];
    v2 = a[2];
    while (a !== a) a = [a];
    v3 = b[3];
    v4 = a[4];
    while (v5 !== v5) v5 = [v5];
    v5 = NaN;
    while (v5 !== v5) v5 = [v4];
    if (rare) throw new Error("rare");
  } catch (e) {
    while (s !== s) s = [s];
    s = mix(s, v1 * 4);
    v0 = v0 + 1;
  }
  while (v0 !== v0) v0 = [v0];
  s = mix(s, v0 * 4);
  s = mix(s, v3 * 4);
  return [s, v0, v1, v2, v3, v4, JSON.stringify(v5)].join();
}
console.log(big(a, b, false));
console.log(big(a, b, true));
