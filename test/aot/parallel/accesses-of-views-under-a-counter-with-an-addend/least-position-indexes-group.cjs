// The least position of a group of accesses is checked to be no negative index, and the others lie above it.
// STATISTIC: GroupsIndexedByLeastPosition >= 2
(function () {
  var buffer = new ArrayBuffer(256);
  var words = new Int32Array(buffer), halves = new Int16Array(buffer);
  function insert(base, times) {
    base = base | 0;
    times = times | 0;
    var sum = 0;
    for (; times; times = times - 1 | 0) {
      words[base + 24 >> 2] = words[base + 24 >> 2] + times | 0;
      words[base + 16 >> 2] = (words[base + 20 >> 2] << 1 ^ words[base + 24 >> 2]) & 1023;
      words[base + 12 >> 2] = words[base + 16 >> 2] + words[base + 28 >> 2] | 0;
      sum = sum + (halves[base + 6 >> 1] | 0) + (halves[base + 8 >> 1] | 0) + (halves[base + 4 >> 1] | 0) | 0;
      words[base + 20 >> 2] = sum + words[base + 12 >> 2] | 0;
    }
    return sum;
  }
  var log = [];
  for (var position of [0, 4, 64, 220, 228, 232, 240, 252, 256, 1024, -4, -8, -12, -16, -20, -28, -1024, 2147483640, -2147483648])
    log.push(position + ": " + insert(position, 5));
  words.fill(3);
  log.push(insert(8, 40), words.join(), halves[7]);
  if (buffer.transfer) {
    buffer.transfer();
    log.push(insert(8, 4));
  }
  console.log(log.join("\n"));
})();
