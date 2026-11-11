function make() {
  let last;
  function run(measure) {
    let work = 0;
    for (let i = 0; i < 2; i++) work = (work + i) | 0;
    const got = measure(-3, work);
    last = measure;
    return got + work;
  }
  return { run, same: () => last === Math.max };
}
const made = make();
let total = 0, missed = 0;
for (let turn = 0; turn < 300; turn++) {
  try { total += made.run(turn % 50 === 49 ? undefined : Math.max); }
  catch (error) { missed += error.name === "TypeError" ? 1 : 100; }
}
console.log(total, missed, made.same());
