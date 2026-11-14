// try in catch in finally, errors replaced on the way out
function deep(n) {
  const log = [];
  try {
    try {
      try {
        if (n > 0) throw new Error("first");
        log.push("calm");
      } catch (error) {
        log.push(error.message);
        if (n > 1) throw new TypeError("second");
      } finally {
        log.push("inner");
        if (n > 2) throw new RangeError("third");
      }
    } finally {
      log.push("middle");
    }
  } catch (error) {
    log.push(error.name + ":" + error.message);
  }
  return log.join(" ");
}
console.log(deep(0) + " | " + deep(1));
console.log(deep(2));
console.log(deep(3));
