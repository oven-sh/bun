function draw({ span = 80, rows = 24, look: { tint = "none", heavy = false } = {}, after = undefined } = {}) {
  after?.(span);
  return span + rows + tint.length + (heavy ? 1 : 0);
}
function run(turns) {
  let total = 0, seen = 0;
  const note = width => { seen += width; };
  for (let i = 0; i < turns; i++)
    total += draw({ span: i & 63 }) + draw({ rows: 10, look: { heavy: true } }) + draw({ look: { tint: "red" }, after: note }) + draw();
  return total + seen;
}
console.log(run(30000));
