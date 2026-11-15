function tried(fail, value) {
  try {
    if (fail) throw new Error("no");
    value += 1;
  } catch (error) {
    value += error.message.length * 10;
  }
  return () => value++;
}
function cleaned(fail, value, log) {
  try {
    try {
      if (fail) throw new Error("out");
      log.push("through");
    } finally {
      value += 5;
    }
  } catch {
    log.push("caught");
  }
  return () => value;
}
const log = [];
const a = tried(false, 1), b = tried(true, 1);
console.log(a(), a(), b(), b(), cleaned(false, 1, log)(), cleaned(true, 2, log)(), log.join());
