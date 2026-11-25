function sum(turns, total) {
  for (let i = 0; i < turns; i++) {
    total += i;
  }
  return () => total;
}
function until(limit, at) {
  while (at < limit) {
    at += 2;
  }
  const read = () => at;
  at += 100;
  return read;
}
function over(list, seen) {
  for (const item of list) {
    seen = seen + item;
  }
  return [() => seen, () => (seen += "!")];
}
const [read, add] = over(["a", "b"], ">");
console.log(sum(0, 7)(), sum(1, 7)(), sum(4, 7)(), until(5, 0)(), until(0, 3)(), read(), add(), read(), over([], "-")[0]());
