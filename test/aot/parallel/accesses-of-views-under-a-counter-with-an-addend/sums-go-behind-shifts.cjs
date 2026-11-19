// (left << shift) + right >> shift is left + (right >> shift) wherever the position lies inside a view.
// STATISTIC: PositionsSummedBehindShift >= 4
(function () {
  var buffer = new ArrayBuffer(512);
  var words = new Int32Array(buffer), halves = new Uint16Array(buffer), wide = new Int16Array(buffer);
  function chase(from, mask, base, times) {
    from = from | 0;
    mask = mask | 0;
    base = base | 0;
    times = times | 0;
    var at = from, sum = 0;
    for (; times; times = times - 1 | 0) {
      at = halves[((at & mask) << 1) + base >> 1] | 0;
      sum = sum + at + (words[base + (at << 2) >> 2] | 0) | 0;
    }
    return sum;
  }
  function fill(at, base, times) {
    at = at | 0;
    base = base | 0;
    times = times | 0;
    var sum = 0;
    for (; times; times = times - 1 | 0) {
      halves[(at << 1) + base >> 1] = times + at;
      wide[base + (at << 3) >> 1] = times - at;
      sum = sum * 3 + (words[(at << 2) + base >> 2] | 0) + (wide[(at << 2) + base >> 1] | 0) | 0;
      at = at + 1 | 0;
    }
    return sum;
  }
  var log = [];
  for (var i = 0; i < halves.length; i++)
    halves[i] = i * 37 + 11 & 127;
  for (var base of [0, 1, 2, 3, 4, 6, 63, 128, 254, 500, 508, 511, 512, 513, -1, -2, -3, -4, -256, 2147483647, 2147483646, -2147483648, -2147483647, 1073741824, -1073741824]) {
    for (var from of [0, 1, 5, 63, -1, -2, 255, 256, 65535, 1073741823, 1073741824, -1073741824, 2147483647, -2147483648, 536870912, -536870912])
      log.push(chase(from, 63, base, 6), chase(from, -1, base, 3), chase(from, 2147483647, base - from | 0, 2), chase(from, -1, base - (from << 1) | 0, 2));
    log.push(base + ";");
  }
  console.log(log.join(" "));
  log = [];
  for (var base of [0, 1, 2, 3, 4, 8, 100, 500, 508, 512, -4, -8, 2147483640, -2147483648, 1073741824, -1073741824]) {
    for (var at of [0, 1, 7, 100, 255, -1, -4, 1073741823, 1073741824, -1073741824, 536870912, -536870911, 2147483644, -2147483648, 268435456])
      log.push(fill(at, base, 5), fill(at, base - (at << 2) | 0, 3), fill(at, base - (at << 1) | 0, 2));
  }
  console.log(log.join(" "));
  console.log(words.join(" "));
  if (buffer.transfer) {
    buffer.transfer();
    console.log(chase(3, 63, 4, 4), fill(1, 4, 3));
  }
})();
