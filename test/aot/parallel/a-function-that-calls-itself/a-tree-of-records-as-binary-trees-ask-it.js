// case: a tree of records, as binary trees ask it
const far = process.argv.length > 99 ? "y" : "";
const size = process.argv[2] ? +process.argv[2] : 10;
function make(depth) {
  return depth < 1 ? { left: null, right: null } : { left: make(depth - 1), right: make(depth - 1) };
}
function count(tree) {
  return tree.left === null ? 1 : 1 + count(tree.left) + count(tree.right);
}
function work(n) { return count(make(n)); }
function model(n) {
  const held = { ["all" + far]: 0 };
  for (let i = 0; i <= n; i++) held["all" + far] += 2 ** i;
  return held["all" + far];
}
function run() {
  const got = work(size);
  console.log(String(got) + far, String(got) === String(model(size)));
}
run();
run();
