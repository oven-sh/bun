// some turns read a list under a key that comes off a list of keys; later the list of keys has holes: the read goes under `undefined` and finds what lies under that name.
var KEYS = [], ROWS = [], SKIP = [];
for (var k = 0; k < 40; k++) { KEYS[k] = k % 9; SKIP[k] = k % 3 === 0 ? 1 : 0; }
for (k = 0; k < 9; k++) ROWS[k] = 1 << k;
function f(n) {
  var sum = 0;
  for (var i = 0; i < n; i++) {
    if (SKIP[i]) continue;
    sum += ROWS[KEYS[i]] | 0;
  }
  return sum;
}
var all = '';
for (var t = 0; t < 60; t++) {
  if (t === 41) { KEYS[44] = 3; ROWS['undefined'] = 4096; }
  var said = f(t < 41 ? 40 : 45);
  if (t >= 40 && t <= 42) all += said + '|';
}
console.log(all);
