enum Level {
  Low = 1,
  // @ts-ignore
  "1" = 7,
}
const unseen = (0, eval)("(x) => x");
const level = unseen(Level);
console.log(String(level[1]), String(level[7]), String(level.Low));
