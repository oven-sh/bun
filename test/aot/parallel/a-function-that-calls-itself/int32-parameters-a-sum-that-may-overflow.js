// case: int32 parameters, a sum that may overflow
const far = process.argv.length > 99 ? "y" : "";
const size = process.argv[2] ? +process.argv[2] : 24;
function fib(n) {
  if (n < 2) return n;
  return fib((n - 1) | 0) + fib((n - 2) | 0);
}
function work(n) { return fib(n | 0); }
function model(n) {
  const held = { ["a" + far]: 0, ["b" + far]: 1 };
  for (let i = 0; i < n; i++) {
    const next = held["a" + far] + held["b" + far];
    held["a" + far] = held["b" + far];
    held["b" + far] = next;
  }
  return held["a" + far];
}
function run() {
  const got = work(size);
  console.log(String(got) + far, String(got) === String(model(size)));
}
run();
run();
