// case: no answer is kept: the calls alone
const far = process.argv.length > 99 ? "y" : "";
const size = process.argv[2] ? +process.argv[2] : 24;
let calls = 0;
function walk(n) {
  calls = (calls + 1) | 0;
  if (n < 2) return;
  walk(n - 1);
  walk(n - 2);
}
function work(n) {
  calls = 0;
  walk(n);
  return calls;
}
function model(n) {
  const held = { ["a" + far]: 1, ["b" + far]: 1 };
  for (let i = 1; i < n; i++) {
    const next = 1 + held["a" + far] + held["b" + far];
    held["a" + far] = held["b" + far];
    held["b" + far] = next;
  }
  return held["b" + far];
}
function run() {
  const got = work(size);
  console.log(String(got) + far, String(got) === String(model(size)));
}
run();
run();
