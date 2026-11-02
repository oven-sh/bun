// Nested finally order: compiled answers as plain.
const log = [];
function f() {
  try {
    try {
      throw 1;
    } finally {
      log.push("inner");
    }
  } catch (e) {
    log.push("caught" + e);
    return "r";
  } finally {
    log.push("outer");
  }
}
console.log(f(), log.join());
