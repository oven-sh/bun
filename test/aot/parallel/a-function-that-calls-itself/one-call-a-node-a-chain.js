// case: one call a node: a chain
const far = process.argv.length > 99 ? "y" : "";
const size = process.argv[2] ? +process.argv[2] : 2000;
function chain(n) {
  if (n < 1) return 0;
  return n + chain(n - 1);
}
function work(n) {
  let all = 0;
  for (let i = 0; i < 200; i++) all = chain(n);
  return all;
}
function model(n) {
  const held = { ["s" + far]: 0 };
  for (let i = n; i >= 1; i--) held["s" + far] += i;
  return held["s" + far];
}
function run() {
  const got = work(size);
  console.log(String(got) + far, String(got) === String(model(size)));
}
run();
run();
