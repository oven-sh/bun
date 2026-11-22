// Unions, differences and what both have, over Sets of texts
function combine(a, b) {
  const x = new Set(a), y = new Set(b);
  const both = new Set([...x].filter(one => y.has(one)));
  const either = new Set([...x, ...y]);
  const only = new Set(x);
  for (const one of y) only.delete(one);
  return [both, either, only].map(set => [...set].sort().join("")).join() + " " + [...x].every(one => y.has(one)) + either.size;
}
console.log(combine("abc", "bcd"));
console.log(combine("aab", "ba"));
console.log(combine("x", "yz"));
