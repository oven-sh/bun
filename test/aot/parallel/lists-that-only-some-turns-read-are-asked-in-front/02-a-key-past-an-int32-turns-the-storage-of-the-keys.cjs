// the list of keys is found with int32s, then a whole number past an int32 is stored into it: its storage is another, and that key finds nothing.
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
  if (t === 41) KEYS[8] = 4294967298;
  var said = f(t);
  if (t >= 40 && t <= 42) all += said + '|';
}
console.log(all);
