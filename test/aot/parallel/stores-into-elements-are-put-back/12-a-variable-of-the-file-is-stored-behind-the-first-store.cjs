// as 11, the variable of the file is stored behind the first store into an element.
var o = [0.5, 1.5, 2.5], a = [], w = [], count = 0;
for (var k = 0; k < 48; k++) { w[k] = k & 3; if (k < 40) a[k] = k + 0.25; }
function f(n) {
  var sum = 0, t = 0.5;
  o[0] = 0.5; o[1] = 1.5; count = 0;
  for (var i = 0; i < n; i++) {
    o[0] = o[0] + 1.5;
    count = count + 1;
    if (i & 1) { t = sum * 0.5; o[1] = a[i] + t; } else { o[1] = a[i] * 2; }
    sum = sum + w[i];
  }
  return o[0] * 1000 + o[1] + sum * 7 + t + "/" + count;
}
var all = '';
for (var t = 0; t < +(process.argv[2] ?? 60); t++) {
  if (t === 41) a[44] = 1.5;
  var said = f(t < 41 ? 40 : 45);
  if (t >= 40 && t <= 42) all += said + '|';
}
console.log("SAID " + all);
