module.exports = f;
module.exports.a = 1;
module.exports.b = 2;
module.exports.c = 3;
function f() {
  return [f.a, f.b, f.c].join();
}
