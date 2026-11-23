// case: its parameter is stored into and captured
const far = process.argv.length > 99 ? "y" : "";
const size = process.argv[2] ? +process.argv[2] : 7;
function grow(n) {
  const read = () => n;
  n = n + 1;
  if (n > 8) return read();
  return grow(n) + read();
}
function work(n) { return grow(n - 6); }
function model(n) {
  const held = { ["s" + far]: 0 };
  for (let v = n - 6 + 1; ; v++) {
    held["s" + far] += v;
    if (v > 8) return held["s" + far];
  }
}
function run() {
  const got = work(size);
  console.log(String(got) + far, String(got) === String(model(size)));
}
run();
run();
