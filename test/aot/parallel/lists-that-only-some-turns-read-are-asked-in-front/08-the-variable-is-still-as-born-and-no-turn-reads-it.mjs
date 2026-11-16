// the function runs before the module has filled its variable, and no turn takes the arm that reads it; later the variable is filled and the arm is taken.
var first = weigh(0);
var KEYS = [], ROWS = [];
for (var k = 0; k < 40; k++) KEYS[k] = k % 9;
for (k = 0; k < 9; k++) ROWS[k] = 1 << k;
function weigh(mask) {
  var sum = 0;
  for (var i = 0; i < 40; i++) {
    sum += i;
    if (i & mask) sum += ROWS[KEYS[i]] | 0;
  }
  return sum;
}
var all = first + '|';
for (var t = 0; t < 60; t++) {
  var said = weigh(t === 41 ? 0 : 1);
  if (t >= 40 && t <= 42) all += said + '|';
}
console.log(all);
