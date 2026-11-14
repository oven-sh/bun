const log = [];
function leave(how) {
  let outer = how.length;
  try {
    if (how === "return") return "returned";
    if (how === "throw") throw new Error("thrown");
    log.push("fell");
  } catch (error) {
    log.push(error.message);
    if (outer > 4) return "caught";
  } finally {
    {
      let inner = outer * 2;
      log.push("finally");
      const read = () => inner + outer;
      inner += 1;
      outer += 1;
      log.push(read());
    }
  }
  return (() => "end " + outer)();
}
function loops() {
  const made = [];
  outer: for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      try {
        if (j === 1) continue outer;
        if (i === 2) break outer;
      } finally {
        let both = i * 10 + j;
        made.push(() => both++);
      }
    }
  }
  return made.map((one) => one() + one()).join();
}
console.log(leave("return"), leave("throw"), leave("fall"), log.join());
console.log(loops());
