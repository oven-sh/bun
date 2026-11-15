// case: a method that calls itself
const far = process.argv.length > 99 ? "y" : "";
const size = process.argv[2] ? +process.argv[2] : 12;
class Walk {
  constructor() { this.seen = 0; }
  go(n) {
    this.seen++;
    return n < 1 ? 1 : this.go(n - 1) + this.go(n - 1);
  }
}
function work(n) {
  const walk = new Walk();
  return walk.go(n) + walk.seen;
}
function model(n) {
  const held = { ["all" + far]: 2 ** n };
  for (let i = 0; i <= n; i++) held["all" + far] += 2 ** i;
  return held["all" + far];
}
function run() {
  const got = work(size);
  console.log(String(got) + far, String(got) === String(model(size)));
}
run();
run();
