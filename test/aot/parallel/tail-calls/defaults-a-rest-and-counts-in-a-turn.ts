// turns of a self tail call hand too few and too many operands to defaults, a rest and arguments.length
let log: string[] = [];
function turn(n: number, a = "da", b: string = a + "!", ...others: unknown[]): string {
  log.push(n + ":" + a + ":" + b + ":" + others.join("|") + ":" + arguments.length);
  if (n === 0) return log.join(" ");
  if (n === 1) return turn(0);
  if (n === 2) return turn(1, undefined, "b");
  if (n === 3) return turn(2, "a", undefined, 1, 2, 3);
  return turn(n - 1, "x", "y", n);
}
function deed(n: number) {
  log = [];
  return turn(n);
}
console.log(deed(0));
for (let i = 1; i < 7; i++) console.log(deed(i));
console.log(deed(3));
