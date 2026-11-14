// case: the kinds differ in the second level
const far = process.argv.length > 99 ? "y" : "";
const size = process.argv[2] ? +process.argv[2] : 6;
function mix(v) {
  if (typeof v === "string") return v.length > 5 ? v : mix(v + v.length);
  return v < 1 ? mix("x") : mix(v - 1) + v;
}
function work(n) { return mix(n); }
function model(n) {
  const held = { ["t" + far]: "x" };
  while (held["t" + far].length <= 5) held["t" + far] += held["t" + far].length;
  for (let i = 1; i <= n; i++) held["t" + far] += i;
  return held["t" + far];
}
function run() {
  const got = work(size);
  console.log(String(got) + far, String(got) === String(model(size)));
}
run();
run();
