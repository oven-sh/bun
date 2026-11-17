// Each row of costs is made of pushes, beside the row above it. The two texts are fields of an object of the program or of one that JSON.parse made.
function costsOf(pair) {
  const from = pair.from, to = pair.to;
  let above = (() => { const first = []; for (let at = 0; at < to.length + 1; at++) first.push(at); return first; })();
  for (let row = 1; row <= from.length; row++) {
    const costs = [row];
    for (let at = 1, last = to.length; at <= last; at++) {
      const replaced = from[row - 1] === to[at - 1] ? 0 : 1;
      costs.push(Math.min(above[at] + 1, Math.min(costs[at - 1] + 1, above[at - 1] + replaced)));
    }
    above = costs;
  }
  return above;
}
console.log(String(costsOf({ from: "winter", to: "written" })), String(costsOf({ from: "", to: "row" })), String(costsOf({ from: "column", to: "" })));
console.log(String(costsOf(JSON.parse('{"from":"winter","to":"written"}'))), String(costsOf(JSON.parse('{"from":"left","to":"felt"}'))));
