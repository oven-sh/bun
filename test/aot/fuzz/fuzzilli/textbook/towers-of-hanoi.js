function moved(count, from, to, spare, out) {
  if (count === 0) return out;
  moved(count - 1, from, spare, to, out);
  out.push(from + to);
  return moved(count - 1, spare, to, from, out);
}
console.log(moved(Number("3"), "a", "c", "b", []).join());
