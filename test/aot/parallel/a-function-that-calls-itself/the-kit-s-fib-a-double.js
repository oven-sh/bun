// case: the kit's fib, a double
const far = process.argv.length > 99 ? "y" : "";
const size = process.argv[2] ? +process.argv[2] : 24;
function work(n) {
  if (n < 2) return n;
  return work(n - 1) + work(n - 2);
}
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
