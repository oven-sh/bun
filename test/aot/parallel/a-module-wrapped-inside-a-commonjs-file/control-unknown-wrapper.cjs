var wrap = (body) => () => body({});
var total;
function look() {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return total;
}
var require_inner = wrap((exports) => { exports.kind = typeof look(); return exports; });
console.log(require_inner().kind);
total = process.argv.length + 40;
console.log(typeof look());
