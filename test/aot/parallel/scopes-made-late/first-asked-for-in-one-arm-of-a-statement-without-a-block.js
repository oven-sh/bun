function pick(flag, seed) {
  let count = seed;
  let other = seed * 2;
  const log = [];
  log.push(typeof flag);
  if (flag) count = count + 1;
  else log.push("else");
  const read = () => count + other;
  other += 1;
  log.push(read());
  return log.join();
}
function nested(a, b) {
  let total = 0;
  const log = [];
  while (a-- > 0) if (b) for (const step of [1, 2]) total += step;
  log.push((() => total)());
  do if (!b) total -= 1; while (total > -2 && !b);
  log.push((() => total)());
  return log.join();
}
console.log(pick(true, 1), pick(false, 1), pick(0, 5), pick("x", 5));
console.log(nested(2, true), nested(2, false), nested(0, true), nested(0, false));
