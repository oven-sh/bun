// The body of do { .. } while (0) is no loop: nothing is visited twice for it.
// STATISTIC: LoopVisits <= 0
(function () {
  function choose(value, table) {
    var label = 0, sum = 0;
    do {
      if (value < 0) {
        sum = -value;
        break;
      }
      do {
        if (value > 10) {
          label = 2;
          break;
        }
        sum = table[value & 3] * 2;
        label = 1;
      } while (!1);
      if (label == 2)
        continue;
      sum = sum + label;
    } while (0);
    return sum + ":" + label;
  }
  console.log(choose(-3, [1, 2, 3, 4]), choose(2, [1, 2, 3, 4]), choose(40, [1, 2, 3, 4]), choose(7, [1, 2, 3, 4]), choose(0, [5]));
})();
