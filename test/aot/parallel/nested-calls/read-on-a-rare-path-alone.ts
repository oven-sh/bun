function outer(rare: boolean, n: number) {
  let total = 0;
  for (let i = 0; i < n; i++) total += step(i);
  const kept = rare ? step : undefined;
  return total + ":" + (kept ? kept(100) : "none") + ":" + (kept === (rare ? step : undefined));
  function step(x: number) { return x + n; }
}
console.log(outer(false, 3), outer(true, 3));
