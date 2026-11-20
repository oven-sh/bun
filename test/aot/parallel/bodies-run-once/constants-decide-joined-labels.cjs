// A path that brings a constant into a join does not test it there.
// STATISTIC: JoinsPartedByConstants >= 12
(function () {
  function pass(kinds, first, second) {
    var label = 0, left = first | 0, right = second | 0, sum = 0, i = 0;
    for (; i < kinds.length; i = i + 1 | 0) {
      var kind = kinds[i] | 0;
      do {
        if (kind < 3) {
          left = left + 2 | 0;
          if (kind === 0) {
            right = right ^ 5;
            break;
          }
          if (kind === 1) {
            label = 12;
            break;
          }
          label = 14;
        } else {
          right = right + left | 0;
          label = kind > 5 ? 12 : 13;
        }
      } while (0);
      do {
        if ((label | 0) == 12) {
          label = 0;
          left = left * 3 | 0;
          if ((left & 3) == 0) {
            label = 16;
            break;
          }
          right = right - 1 | 0;
          label = 15;
        } else if ((label | 0) == 13) {
          label = 0;
          right = right ^ left;
        }
      } while (0);
      if ((label | 0) == 15) {
        label = 0;
        sum = sum + right | 0;
      } else if ((label | 0) == 16) {
        label = 0;
        sum = sum - left | 0;
      } else if (label != 14)
        sum = sum + left * right | 0;
      if (label === 14) {
        sum = sum ^ kind;
        if ((sum & 1) == 0)
          label = 0;
      }
    }
    if ((label | 0) == 14)
      return "left at 14: " + sum;
    return sum + "," + left + "," + right + "," + label;
  }
  function scan(text) {
    var state = 0, words = 0, digits = 0, last = -1;
    for (var i = 0; i < text.length; i++) {
      var code = text.charCodeAt(i), next;
      if (code >= 48 && code <= 57) {
        next = 2;
        digits++;
      } else if (code === 32) {
        next = 0;
        if (state === 1)
          words++;
      } else if (code > 64)
        next = 1;
      else {
        next = state;
        last = i;
      }
      if (next === 2)
        last = digits + i;
      else if (next === 0)
        last = words - i;
      state = next;
    }
    return [state, words, digits, last].join();
  }
  function throughHandler(values) {
    var label = 0, seen = [], held = 1;
    for (var i = 0; i < values.length; i++) {
      try {
        if (values[i] === null) {
          label = 3;
          held = values[i].size;
        } else if (values[i] > 2) {
          held = held + values[i];
          label = 4;
        } else
          label = 5;
        if (label == 4)
          seen.push("four " + held);
        else
          seen.push(label);
      } catch (error) {
        seen.push(error instanceof TypeError, label, held);
      }
      if (label === 3)
        held = 1;
    }
    return seen.join();
  }
  var log = [];
  for (var seed = 1; seed < 40; seed++) {
    var kinds = [];
    for (var k = 0, word = seed * 2654435 >>> 0; k < 24; k++) {
      word = word * 1103515245 + 12345 >>> 0;
      kinds.push((word >>> 16) % 8);
    }
    log.push(pass(kinds, seed, -seed), pass([seed % 8], 1.5, "7"), pass([], seed, 0));
  }
  log.push(pass([NaN, undefined, null, "1", {}, 6, 2], -0, 2147483647));
  log.push(scan("ab 12 c! 9  z?"), scan(""), scan("... 7 a"), scan("word word2 x"));
  log.push(throughHandler([1, 2, 3, null, 4, undefined, 9, NaN, null, 5]));
  console.log(log.join("\n"));
})();
