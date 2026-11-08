var __esm = (fn, res) => () => (fn && (res = fn((fn = 0))), res);
var total;
var seen;
function look() {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return total;
}
var init_inner = __esm(() => { seen = typeof look(); });
init_inner();
console.log(seen);
total = process.argv.length + 40;
console.log(typeof look());
