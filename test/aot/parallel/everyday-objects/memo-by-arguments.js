// Results kept in an object by their arguments, with hits counted
function memo(call) {
  const kept = {};
  const wrapped = (...all) => {
    const key = all.join(",");
    if (key in kept) {
      wrapped.hits++;
      return kept[key];
    }
    return (kept[key] = call(...all));
  };
  wrapped.hits = 0;
  return wrapped;
}
function paths(width, height) {
  const count = memo((x, y) => (x === 0 || y === 0 ? 1 : count(x - 1, y) + count(x, y - 1)));
  return count(width, height) + " " + count.hits;
}
console.log(paths(2, 3));
console.log(paths(10, 10));
console.log(paths(0, 4));
