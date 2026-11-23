// case: a handler around its own call
const far = process.argv.length > 99 ? "y" : "";
const size = process.argv[2] ? +process.argv[2] : 6;
function tries(n) {
  try {
    if (n < 1) throw n;
    return tries(n - 1) + 1;
  } catch (error) {
    return error === 0 ? 10 : -1;
  } finally {
    n = 0;
  }
}
function work(n) { return tries(n); }
function model(n) {
  const held = { ["v" + far]: 10 };
  for (let i = 0; i < n; i++) held["v" + far] += 1;
  return held["v" + far];
}
function run() {
  const got = work(size);
  console.log(String(got) + far, String(got) === String(model(size)));
}
run();
run();
