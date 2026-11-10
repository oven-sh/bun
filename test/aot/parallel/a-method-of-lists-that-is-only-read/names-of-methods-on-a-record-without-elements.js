function pick(options, rows) {
  let kept = rows;
  if (options.filter) kept = kept.filter(options.filter);
  if (options.sort) kept = kept.slice().sort(options.sort);
  return kept.join() + "/" + (options.map ? "mapped" : "plain") + "/" + typeof options.length;
}
const rows = [3, 1, 2, 5, 4];
console.log(pick({ filter: n => n > 1, sort: (a, b) => b - a }, rows));
console.log(pick({ sort: undefined, map: 1, length: 2 }, rows));
for (const options of [[], "text", 7]) {
  try {
    console.log(pick(options, rows));
  } catch (e) {
    console.log(e.name);
  }
}
