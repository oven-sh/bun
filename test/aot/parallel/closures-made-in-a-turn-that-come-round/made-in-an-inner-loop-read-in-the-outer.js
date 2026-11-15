const n = (value) => Number(process.argv[8] ?? value);
function run(turns) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  let count = 0;
  let seen = 0;
  let last = null;
  for (let turn = 0; turn < turns; turn++) {
    for (let j = 0; j < 2; j++) { if (last !== null) last(); last = () => { count += 1; }; }
    seen += count;
  }
  return seen + " " + count + " " + work;
}
console.log(run(n(5)));
console.log(run(n(3)));
