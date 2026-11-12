// Returns in try, catch and finally, and what wins
function win(n, log) {
  for (let i = 0; i < 3; i++) {
    try {
      log.push("t" + i);
      if (n === 0) return "try";
      if (n === 1) throw new Error("e");
      if (n === 2) continue;
    } catch (error) {
      return "catch " + error.message;
    } finally {
      log.push("f" + i);
      if (n === 3 && i === 1) return "finally";
      if (n === 1) break;
    }
  }
  return "end";
}
function all(list) {
  const log = [];
  return list.map(n => win(n, log)).join() + " " + log.join("");
}
console.log(all([0, 1]));
console.log(all([2, 3]));
console.log(all([4, 0, 4]));
