// What a WeakSet of one function held is collected while its loop runs.
function run(count) {
  const seen = new WeakSet();
  let added = 0;
  for (let i = 0; i < count; i++) {
    const item = { i, padding: new Array(1024).fill(i) };
    if (seen.has(item)) continue;
    seen.add(item);
    added++;
  }
  return added;
}
console.log(run(300_000));
console.log(process.memoryUsage.rss() < 1_200_000_000);
