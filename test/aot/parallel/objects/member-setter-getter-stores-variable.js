// The getter is written behind the member that stores to `c`, and returns what was stored.
function make(v) {
  let c = 0;
  return { set p(x) {}, q: (c = v), get p() { return c; } };
}
console.log(make(Number(process.argv[2] ?? 5)).p);
