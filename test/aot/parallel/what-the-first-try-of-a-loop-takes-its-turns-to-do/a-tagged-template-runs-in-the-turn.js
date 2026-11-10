const box = { held: 0 };
function tag(strings, value) {
  box.held = box.held + strings.length;
  return box.held === 6 ? null : value;
}
function run(start) {
  let at = start;
  const before = box.held;
  while (at !== null) at = tag`a${at}b`;
  return [before, box.held].join();
}
console.log(run(1));
