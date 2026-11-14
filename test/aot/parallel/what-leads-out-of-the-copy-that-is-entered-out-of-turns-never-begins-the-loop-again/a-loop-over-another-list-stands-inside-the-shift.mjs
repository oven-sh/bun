// Under: --aot-testing=FailSpeculations:7:61: some guesses fail in the middle of the loops
// Under: --aot-testing=FailSpeculations:3:50: others do
// Under: --aot-testing=FailSpeculations: every guess fails
function show(...all) { return all.map(one => (typeof one)[0] + (Object.is(one, -0) ? "-0" : String(one))).join(" "); }
function run(a, b, mark) {
  let s = 0, x = 0, h = 0;
  for (let c = a.length - 1; c >= 0; c--) {
    for (let k = 0; k < b.length; k++) { s += b[k]; if (b[k] === mark) b[k] = s & 7; }
    if (a[c] === mark) h++;
    x = a[c - 1];
    if (c + 1 < a.length) a[c + 1] = x;
  }
  return show(s, x, h, a[0], a.length, b[0]);
}
for (const mark of JSON.parse("[9, 1, 7, 3]")) {
  for (const b of [JSON.parse("[2, 7, 1, 8]"), new Uint8Array([2, 7, 1, 8]), JSON.parse("[0.5, 7, 1.5]"), JSON.parse("[]")]) {
    const a = JSON.parse("[3, 1, 4, 1, 5, 9, 2, 6]");
    let said; try { said = run(a, b, mark); } catch { said = "threw"; }
    console.log(said + " | " + show(...a) + " | " + show(...b));
  }
}
