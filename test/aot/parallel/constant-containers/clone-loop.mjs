function fresh(n) { const cells = new Map(); for (let i = 0; i < n; i++) cells.set(i, [0, 0, 0]); return cells; }
function play(n) {
  const copy = structuredClone(fresh(n));
  copy.get(0)[0] = 1;
  return `${copy.get(0)[0]} ${copy.get(1)[0]} ${copy.get(2)[0]}`;
}
console.log(play(3));
console.log(play(4));
