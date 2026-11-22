function make() {
  let last;
  function run(load) {
    let work = 0;
    for (let i = 0; i < 2; i++) work = (work + i) | 0;
    const got = load("node:path");
    last = load;
    return typeof got.join === "function" ? 1 + work : 100;
  }
  return { run, same: () => last === require };
}
const made = make();
let total = 0, missed = 0;
for (let turn = 0; turn < 300; turn++) {
  try { total += made.run(turn % 50 === 49 ? undefined : require); }
  catch (error) { missed += error.name === "TypeError" ? 1 : 100; }
}
console.log(total, missed, made.same());
