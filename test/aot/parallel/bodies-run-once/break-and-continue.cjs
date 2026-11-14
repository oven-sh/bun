// do { .. } while (0) runs its body once. Nothing goes round in it.
(function () {
  var log = [];
  function classify(value) {
    var label = 0, sum = 0;
    do {
      if (value < 0) {
        sum = -value;
        break;
      }
      if (value === 0)
        continue;
      do {
        if (value > 10) {
          label = 2;
          break;
        }
        sum = value * 2;
        label = 1;
      } while (!1);
      sum += label;
    } while (0);
    return sum + ":" + label;
  }
  function named(text) {
    var parts = "";
    outer: do {
      inner: do {
        if (text === "outer")
          break outer;
        if (text === "inner")
          continue inner;
        if (text === "skip")
          continue outer;
        parts += "body ";
      } while (false);
      parts += "behind ";
    } while (null);
    return parts + text;
  }
  function closures(count) {
    var made = [];
    do {
      let held = count;
      const add = function (more) { return held += more; };
      made.push(add);
      if (count > 2)
        break;
      held = held * 10;
      var late = held;
    } while (0);
    return [made[0](1), made[0](1), late].join();
  }
  function finallyBehind(kind) {
    var steps = [];
    do {
      try {
        steps.push("try");
        if (kind === 1)
          break;
        if (kind === 2)
          continue;
        if (kind === 3)
          throw new Error("thrown");
        if (kind === 4)
          return steps.concat("returned").join();
        steps.push("end");
      } catch (error) {
        steps.push(error.message);
        if (kind === 3)
          continue;
      } finally {
        steps.push("finally");
      }
      steps.push("behind");
    } while (0);
    return steps.join();
  }
  function* steps(count) {
    do {
      yield count;
      if (count > 1)
        break;
      yield count + 1;
      if (count > 0)
        continue;
      yield count + 2;
    } while (0);
    yield "end";
  }
  async function awaited(value) {
    var sum = 0;
    do {
      sum += await value;
      if (sum > 3)
        break;
      sum += await 10;
    } while (0);
    return sum;
  }
  function switched(value) {
    do {
      switch (value) {
        case 1:
          break;
        case 2:
          continue;
        default:
          return "other";
      }
      value += 10;
    } while (0);
    return value;
  }
  function loopsInside(list) {
    var sum = 0;
    for (var i = 0; i < list.length; i++) {
      do {
        if (list[i] & 1)
          continue;
        for (var j = 0; j < 3; j++) {
          if (j === list[i])
            break;
          sum += list[i];
        }
        sum++;
      } while (0);
    }
    return sum;
  }
  for (var value of [-3, 0, 4, 11, NaN, "5", undefined])
    log.push(classify(value));
  for (var text of ["outer", "inner", "skip", "x"])
    log.push(named(text));
  log.push(closures(1), closures(5));
  for (var kind = 0; kind < 5; kind++)
    log.push(finallyBehind(kind));
  for (var count = 0; count < 3; count++)
    log.push([...steps(count)].join());
  log.push(switched(1), switched(2), switched(3), loopsInside([1, 2, 4, 7, 0]));
  log.push(eval("do { 5; if (log.length > 3) break; 7; } while (0)"), eval("do { 5; } while (false)"), eval("1; do { continue; } while (0)"));
  do log.push("no block"); while (0)
  do ; while (0)
  Promise.all([awaited(1), awaited(5), awaited(Promise.resolve(2))]).then(function (sums) {
    log.push(sums.join());
    console.log(log.join("\n"));
  });
})();
