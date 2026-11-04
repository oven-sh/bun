// a finalizer is left by return, break, continue, throw and by falling through
let log: string[] = [];
function compute(text: string): string {
  log.push("computed");
  return text;
}
function leave(way: string): string {
  for (let i = 0; i < 2; i++) {
    try {
      if (way === "return") return compute("r" + i);
      if (way === "break") break;
      if (way === "continue") continue;
      if (way === "throw") throw new Error("t" + i);
      log.push("fell" + i);
    } finally {
      log.push("finally" + i);
    }
    log.push("behind" + i);
  }
  return "end";
}
function deed(way: string) {
  log = [];
  let answer;
  try {
    answer = leave(way);
  } catch (e) {
    answer = (e as Error).message;
  }
  return way + ": " + answer + " " + log.join();
}
console.log(deed("fall"));
for (const way of ["return", "break", "continue", "throw", "fall"]) console.log(deed(way));
console.log(deed("return"));
