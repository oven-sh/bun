enum Level {
  Low = 1,
  // @ts-ignore
  "1" = "one",
}
const unseen = (0, eval)("(x) => x");
const level = unseen(Level);
console.log(String(level[1]), String(level.Low), String(level.one), Object.keys(level).join());
