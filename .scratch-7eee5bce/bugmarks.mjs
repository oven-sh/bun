// For each row: which questions does this runtime answer differently from the row, and which marks does the row carry.
const m = await import("/workspace/bun/test/js/node/assert/deep-equal-cases.ts");
const v = m.verdictsOfRows();
const out = [];
m.cases.forEach((c, i) => {
  const e = m.verdictsInRow(c);
  const wrong = { loose: v[i][0] !== e[0] || v[i][1] !== e[1], strict: v[i][2] !== e[2] || v[i][3] !== e[3], skip: v[i][4] !== e[4] || v[i][5] !== e[5] };
  const marks = { loose: !!c.looseBug, strict: !!c.strictBug, skip: !!c.skipPrototypeBug };
  // the util.isDeepStrictEqual test treats strictBug ?? skipPrototypeBug as one mark
  if (wrong.loose !== marks.loose || wrong.strict !== marks.strict || (wrong.skip && !marks.skip && !marks.strict) || (marks.skip && !wrong.skip && !wrong.strict))
    out.push({ name: c.name, here: v[i], row: e, wrong, marks });
});
console.log(JSON.stringify(out, null, 1));
console.error("rows", m.cases.length, "with a mark problem", out.length);
