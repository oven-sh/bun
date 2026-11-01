export function increments() {
  const out = [];
  for (let x of [0, 1.5, 1n, "1", "x", null, undefined, true, { valueOf() { return 41; } }, { valueOf() { return 41n; } }]) {
    const before = x++;
    out.push(typeof before + ":" + String(before) + ">" + typeof x + ":" + String(x));
    let y = x; --y; out.push(String(y));
  }
  return out;
}
