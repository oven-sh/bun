// A function nobody calls stands beside a read that runs as the file runs: nobody knows the key, nor what it is read off.
// STATISTIC: FunctionsLowered >= 300
function pickNever(from, key) {
  return from[key];
}
const name = JSON.parse('"flatMap"');
try {
  throw [1, 2];
} catch (held) {
  const found = held[name];
  console.log(String(found.call(held, value => [value, value * 2])));
}
