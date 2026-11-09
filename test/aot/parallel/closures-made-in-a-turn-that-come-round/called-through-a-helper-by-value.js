const n = (value) => Number(process.argv[8] ?? value);
const call = (f) => [f][JSON.parse("0")]();
function run(turns) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  let count = 0;
  let seen = 0;
  let last = null;
  for (let turn = 0; turn < turns; turn++) {
    if (last !== null) call(last);
    seen += count;
    last = () => { count += 1; };
  }
  return seen + " " + count + " " + work;
}
console.log(run(n(5)));
console.log(run(n(3)));
