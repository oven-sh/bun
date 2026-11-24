function drops(eggs, floors) {
  const memo = {};
  function least(k, n) {
    if (n <= 1 || k === 1) return n;
    const id = k * 1000 + n;
    if (memo[id] !== undefined) return memo[id];
    let best = n;
    for (let x = 1; x <= n; x++) {
      const worst = 1 + Math.max(least(k - 1, x - 1), least(k, n - x));
      if (worst < best) best = worst;
    }
    memo[id] = best;
    return best;
  }
  return least(eggs, floors);
}
let total = 0;
for (let turn = 0; turn < 20; turn++) total += drops(2 + (turn % 3), 30 + turn);
console.log(total);
