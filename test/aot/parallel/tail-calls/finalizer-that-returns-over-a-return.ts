// a finalizer returns over the return and over the throw that it was entered by
let log: string[] = [];
function compute(text: string): string {
  log.push("computed " + text);
  return text;
}
function over(way: string, wins: boolean): string {
  try {
    if (way === "throw") throw new Error("thrown");
    return compute("tried");
  } finally {
    log.push("finally");
    if (wins) return compute("finalizer");
  }
}
function deed(way: string, wins: boolean) {
  log = [];
  let answer;
  try {
    answer = over(way, wins);
  } catch (e) {
    answer = "caught " + (e as Error).message;
  }
  return answer + " | " + log.join();
}
console.log(deed("return", false));
for (let i = 0; i < 3; i++) console.log(deed("return", i === 1));
console.log(deed("throw", true));
console.log(deed("throw", false));
console.log(deed("return", true));
