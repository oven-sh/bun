// the list under the key has a hole: the read finds nothing, and later the hole is filled with a fraction.
var KEYS = [], ROWS = [], SKIP = [];
for (var k = 0; k < 40; k++) { KEYS[k] = k % 9; SKIP[k] = k % 3 === 0 ? 1 : 0; }
for (k = 0; k < 9; k++) ROWS[k] = 1 << k;
function f(t) {
  var sum = 0;
  for (var i = 0; i < 40; i++) {
    if (SKIP[i]) continue;
    sum += ROWS[KEYS[i]] | 0;
  }
  return sum;
}
var all = '';
for (var t = 0; t < 60; t++) {
  if (t === 41) delete ROWS[4];
  if (t === 42) ROWS[4] = 1024.75;
  var said = f(t);
  if (t >= 40 && t <= 43) all += said + '|';
}
console.log(all);
