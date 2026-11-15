// case: arguments of its own
const far = process.argv.length > 99 ? "y" : "";
const size = process.argv[2] ? +process.argv[2] : 6;
function all(n) {
  if (arguments[0] < 1) return arguments.length;
  return arguments.length + all(n - 1, n);
}
function work(n) { return all(n); }
function model(n) {
  const held = { ["s" + far]: 1 };
  for (let i = 0; i < n; i++) held["s" + far] += 2;
  return held["s" + far];
}
function run() {
  const got = work(size);
  console.log(String(got) + far, String(got) === String(model(size)));
}
run();
run();
