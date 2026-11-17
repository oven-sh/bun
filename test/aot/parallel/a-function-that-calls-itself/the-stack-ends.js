// case: the stack ends
const far = process.argv.length > 99 ? "y" : "";
const size = process.argv[2] ? +process.argv[2] : 1;
function deep(n) { return 1 + deep(n + 1); }
function work(n) {
  try {
    deep(n);
    return "no";
  } catch (error) {
    return error.constructor.name;
  }
}
function model(n) {
  const held = { ["n" + far]: "RangeError" };
  return held["n" + far];
}
function run() {
  const got = work(size);
  console.log(String(got) + far, String(got) === String(model(size)));
}
run();
run();
