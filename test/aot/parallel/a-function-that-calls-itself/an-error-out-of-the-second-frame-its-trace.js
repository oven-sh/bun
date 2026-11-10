// case: an error out of the second frame, its trace
const far = process.argv.length > 99 ? "y" : "";
const size = process.argv[2] ? +process.argv[2] : 5;
function down(n) {
  if (n < 1) throw new Error("bottom");
  return 1 + down(n - 1);
}
function work(n) {
  try {
    return down(n);
  } catch (error) {
    return error.message + String(error.stack).split("\n").filter(it => it.includes("down")).length;
  }
}
function model(n) {
  const held = { ["m" + far]: "bottom" };
  return held["m" + far] + (n + 1);
}
function run() {
  const got = work(size);
  console.log(String(got) + far, String(got) === String(model(size)));
}
run();
run();
