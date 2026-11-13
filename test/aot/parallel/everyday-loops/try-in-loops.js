// try, catch and finally inside two loops that push at each of them
function attempt(list, at) {
  const log = [];
  for (let i = 0; i < list.length; i++) {
    try {
      log.push("t" + i);
      for (const value of list[i]) {
        if (value === at) throw new RangeError("at " + value);
        if (value === null) break;
        log.push(value.length);
      }
      if (i === 2) continue;
      log.push("ok");
    } catch (error) {
      log.push(error.constructor.name);
      if (at === "stop") return log.join();
    } finally {
      log.push("f" + log.length);
    }
  }
  return log.join();
}
console.log(attempt([["a", "bc"], ["x", "d"], ["e"]], "x"));
console.log(attempt([["a", undefined], 5, [null, "b"], [[1, 2]]], "y"));
console.log(attempt([["p"], ["stop"], ["q"]], "stop"), attempt([], 0));
