const log = [];
function left(way) {
  try {
    if (way === "throw") throw new Error("thrown");
    if (way === "return") return "returned";
    log.push("fell through");
  } catch (error) {
    log.push("caught " + error.message);
    return "recovered";
  } finally {
    log.push("finally " + way);
  }
  return "ended";
}
console.log(left("throw"), left("return"), left("none"), log.join());
