// case: a function that is held by a name and replaced
const far = process.argv.length > 99 ? "y" : "";
const size = process.argv[2] ? +process.argv[2] : 8;
let step = function (n) { return n < 1 ? 0 : 1 + step(n - 1); };
function work(n) {
  const first = step(n);
  const kept = step;
  step = n => 100;
  const second = kept(n);
  step = kept;
  return first + second;
}
function model(n) {
  const held = { ["f" + far]: n };
  return held["f" + far] + (n < 1 ? 0 : 101);
}
function run() {
  const got = work(size);
  console.log(String(got) + far, String(got) === String(model(size)));
}
run();
run();
