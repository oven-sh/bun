// A value is compared with itself to find NaN, straight, behind a test of its type, through a second name, and in a loop whose value becomes NaN half way.
function straight(v) {
  return v === v;
}
function behindTest(v) {
  return typeof v === "number" ? v === v : typeof v === "object" ? v === v : "other";
}
function twoNames(v) {
  const w = v;
  return w === v && !(w !== v);
}
function deed(n) {
  let v = 1;
  let log = "";
  for (let i = 0; i < n; i++) {
    if (i === 3) v = v / 0 - v / 0;
    log += v === v ? "s" : "d";
  }
  return log;
}
const values = [NaN, 0, -0, 1.5, "a", null, undefined, {}, [NaN], 0 / 0, Number("x")];
for (let i = 0; i < values.length; i++) console.log(i, straight(values[i]), behindTest(values[i]), twoNames(values[i]));
console.log(deed(6));
