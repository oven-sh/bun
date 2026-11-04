// The scope of `maker` is handed back where a run keeps nothing, and the next run takes the cell. What the run before has stored into `limit` is not there for the next: whoever reads too early is refused again.
function maker(i, early, keep) {
  function read() {
    return limit.n;
  }
  let said = "not asked";
  if (early) {
    try {
      said = read();
    } catch (error) {
      said = error.name;
    }
  }
  const limit = { n: i };
  if (keep) return () => said + " " + read();
  return said + " " + read();
}
const out = [];
out.push(maker(1, false, false));
out.push(maker(2, true, false));
const kept = maker(3, true, true);
out.push(maker(4, true, false));
for (let turn = 0; turn < 200; turn++) maker(turn, false, false);
out.push(maker(5, true, false), kept());
console.log(out.join(" . "));
