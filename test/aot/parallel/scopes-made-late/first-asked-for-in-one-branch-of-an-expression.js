function choose(flag, seed) {
  let kept = seed;
  const log = [];
  const first = flag ? (() => kept)() : -1;
  log.push(first);
  kept += 10;
  log.push((() => kept)());
  return log.join();
}
function shortCircuit(flag, seed) {
  let kept = seed;
  const log = [];
  flag && (kept = kept * 2);
  flag || log.push("not");
  const later = flag ?? (() => kept);
  log.push(typeof later === "function" ? later() : later);
  log.push([1, 2].map((step) => step + kept).join("+"));
  return log.join();
}
function inAnArgument(flag, list) {
  let sum = 0;
  const seen = [flag ? list.forEach((item) => { sum += item; }) : undefined, sum];
  return seen.join("|") + ":" + (() => sum)();
}
console.log(choose(true, 1), choose(false, 1));
console.log(shortCircuit(true, 3), shortCircuit(false, 3), shortCircuit(null, 3), shortCircuit(undefined, 4));
console.log(inAnArgument(true, [1, 2, 3]), inAnArgument(false, [1, 2, 3]));
