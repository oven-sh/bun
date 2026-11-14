// A tag that keeps its strings by identity, called in a loop
const seen = new Map();
function tag(strings, ...values) {
  seen.set(strings, (seen.get(strings) || 0) + 1);
  return strings.join("%") + values.reduce((a, b) => a + b, 0);
}
function run(n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(tag`a${i}b${n}`);
  out.push(tag`a${1}b${2}`);
  return out.join(" ") + " " + [...seen.values()].join();
}
console.log(run(2));
console.log(run(3));
console.log(run(0));
