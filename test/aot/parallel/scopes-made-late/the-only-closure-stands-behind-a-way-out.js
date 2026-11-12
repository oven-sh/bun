function behindReturn(seed) {
  let kept = seed;
  if (seed > 100) kept = 100;
  return kept + 1;
  const never = () => kept;
  never();
}
function behindThrow(seed) {
  let kept = seed;
  try {
    throw new Error("out " + seed);
    kept = (() => kept + 1)();
  } catch (error) {
    return error.message + " " + seed;
  }
}
function behindBreak(list) {
  let out = "";
  for (const item of list) {
    let doubled = item * 2;
    out += item;
    break;
    out += (() => doubled)();
  }
  return out;
}
function behindContinue(list) {
  const made = [];
  for (const item of list) {
    let doubled = item * 2;
    if (item % 2) continue;
    made.push(() => doubled++);
  }
  return made.map((one) => one() + one()).join();
}
console.log(behindReturn(1), behindReturn(500), behindThrow(2), behindBreak([4, 5]), behindContinue([1, 2, 3, 4]));
