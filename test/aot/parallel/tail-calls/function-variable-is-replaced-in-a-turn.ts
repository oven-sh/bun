// the variable through which a function calls itself in tail position is stored to in a turn
let walk = function (n: number, acc: string): string {
  if (n === 0) return acc;
  if (n === 3) walk = other;
  return walk(n - 1, acc + "a");
};
function other(n: number, acc: string): string {
  if (n === 0) return acc + ".";
  return other(n - 1, acc + "b");
}
function deed(n: number) {
  const first = walk;
  const answer = walk(n, "");
  walk = first;
  return answer;
}
console.log(deed(2));
for (let i = 0; i < 4; i++) console.log(deed(i));
console.log(deed(6));
console.log(deed(2));
