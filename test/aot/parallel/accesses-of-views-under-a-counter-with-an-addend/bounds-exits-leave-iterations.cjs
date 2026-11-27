// A group of accesses to a captured view is checked by one comparison. What fails goes on by itself up to the end of the iteration, so the checks that passed hold behind it.
// STATISTIC: JoinsPartedByBoundsExits >= 1
function make(buffer) {
  var words = new Int32Array(buffer), halves = new Int16Array(buffer), wide = new Uint16Array(buffer), bytes = new Uint8Array(buffer);
  function insert(state, last) {
    state = state | 0;
    last = last | 0;
    var at = 0, hash = 0, left = 0, skipped = 0;
    left = words[state + 120 >> 2] | 0;
    do {
      at = words[state + 108 >> 2] | 0;
      words[state + 108 >> 2] = at + 1;
      if (at >>> 0 > last >>> 0)
        skipped = skipped + 1 | 0;
      else {
        hash = (bytes[(words[state + 56 >> 2] | 0) + (at + 3) | 0] ^ words[state + 72 >> 2] << words[state + 88 >> 2]) & words[state + 84 >> 2];
        words[state + 72 >> 2] = hash;
        halves[(words[state + 64 >> 2] | 0) + ((words[state + 52 >> 2] & at + 1) << 1) >> 1] = halves[(words[state + 68 >> 2] | 0) + (hash << 1) >> 1] | 0;
        halves[(words[state + 68 >> 2] | 0) + (words[state + 72 >> 2] << 1) >> 1] = words[state + 108 >> 2] & 65535;
        left = words[state + 120 >> 2] | 0;
      }
      left = left - 1 | 0;
      words[state + 120 >> 2] = left;
    } while ((left | 0) > 0);
    return (skipped << 16) + hash | 0;
  }
  function tally(state, times) {
    state = state | 0;
    times = times | 0;
    var sum = 0, kind = 0;
    for (; times; times = times - 1 | 0) {
      kind = words[state + 8 >> 2] & 3;
      if (kind == 1)
        words[state + 12 >> 2] = words[state + 16 >> 2] + times | 0;
      else if (kind == 2)
        sum = sum + (wide[state + 24 >> 1] | 0) | 0;
      else
        words[state + 4 >> 2] = words[state + 4 >> 2] ^ sum;
      words[state + 8 >> 2] = (words[state + 8 >> 2] | 0) + (words[state + 12 >> 2] & 1) + 1 | 0;
      sum = sum + (words[state >> 2] | 0) | 0;
    }
    return sum | 0;
  }
  return { insert: insert, tally: tally, words: words, bytes: bytes };
}
var log = [];
for (var round = 0; round < 2; round++) {
  var buffer = new ArrayBuffer(4096), made = make(buffer);
  for (var state of [0, 4, 128, 2048, 3968, 3972, 3976, 4080, 4092, 4096, 8192, -4, -8, -108, -120, -4096, 2147483640, 2147483536, -2147483648]) {
    for (var i = 0; i < 1024; i++)
      made.bytes[1024 + i] = i * 7 + round;
    made.words.set([56, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 63, 1024, 0, 512, 768, 17, 0, 0, 63, 2, 0, 0, 0, 0, 5, 0, 0, 9], 0);
    if (state >= 0 && state <= 3968)
      made.words.copyWithin(state >> 2, 0, 31);
    if (state >= 0 && state + 124 <= 4096)
      log.push(made.insert(state, 12), made.words.slice(0, 32).join(" "));
    else
      log.push(made.insert(state, 3));
    log.push(made.tally(state, 7), made.tally(state + 2, 5), made.tally(state | 1, 3));
  }
  if (buffer.transfer) {
    buffer.transfer();
    log.push(made.tally(4, 6), made.insert(0, 4));
  }
}
console.log(log.join("\n"));
