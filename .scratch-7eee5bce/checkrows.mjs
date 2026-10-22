// Compares the six verdicts of each row on this runtime with the fields of the row.
const m = await import("/workspace/bun/test/js/node/assert/deep-equal-cases.ts");
const v = m.verdictsOfRows();
let diff = 0;
const labels = ["loose", "loose swapped", "strict", "strict swapped", "skip", "skip swapped"];
m.cases.forEach((c, i) => {
  const e = m.verdictsInRow(c);
  if (v[i] !== e) {
    diff++;
    const which = [...e].map((x, j) => (x !== v[i][j] ? labels[j] + "=" + v[i][j] : null)).filter(Boolean).join(", ");
    console.log(JSON.stringify(c.name), "here", v[i], "rows", e, "|", which, "| bugs:", [c.looseBug && "L", c.strictBug && "S", c.skipPrototypeBug && "K"].filter(Boolean).join(""));
  }
});
console.log("rows", m.cases.length, "differ", diff);
