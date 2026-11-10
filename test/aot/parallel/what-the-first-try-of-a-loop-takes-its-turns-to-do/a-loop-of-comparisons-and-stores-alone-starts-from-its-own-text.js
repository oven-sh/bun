// STATISTIC: LoopEffectsPredictedFromSource >= 1
function run(list, rare) {
  let a = false,
    b = false,
    c = false,
    turns = null;
  const first = list[0];
  try {
    while (c !== true) {
      if (a !== true) a = true;
      else if (b !== true) b = true;
      else c = true;
      turns = [turns];
    }
    if (rare) throw new Error("rare");
  } catch (e) {
    return [e.message, a, b, c, JSON.stringify(turns), first, list[0]].join();
  }
  return [a, b, c, JSON.stringify(turns), first, list[0]].join();
}
console.log(run([4, 5], false), run([6], true));
