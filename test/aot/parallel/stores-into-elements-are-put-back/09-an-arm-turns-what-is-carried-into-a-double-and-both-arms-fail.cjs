// the turn stores, then forks: one arm reckons with the carried sum as a fraction and reads a list, the other reads it too; a hole fails in the arm that did not reckon: the turn begins again with the sum as it stood at its head.
var o = [0.5, 1.5, 2.5], a = [], pick = [];
for (var k = 0; k < 40; k++) { a[k] = k + 0.25; pick[k] = k & 1; }
function f(n, step) {
  var sum = 0, t = 0.5;
  o[0] = 0.5; o[1] = 1.5;
  for (var i = 0; i < n; i++) {
    o[0] = o[0] + 1.5;
    if (pick[i]) { t = sum * 0.5; o[1] = a[i] + t; } else { o[1] = a[i] * 2; }
    sum = sum + step;
  }
  return o[0] * 1000 + o[1] + sum * 7 + t;
}
var all = '';
for (var t = 0; t < 60; t++) {
  if (t === 41) a[44] = 1.5;
  var said = f(t < 41 ? 40 : 45, 1);
  if (t >= 40 && t <= 42) all += said + '|';
}
console.log(all);
