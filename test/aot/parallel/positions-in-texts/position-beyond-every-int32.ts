// the position is 2 ** 31, 2 ** 32, 2 ** 53 and their negatives
function code(text: string, pos: number): string {
  if (pos < text.length) return String(text.charCodeAt(pos));
  return "outside";
}
function deed(): string {
  return [2 ** 31, 2 ** 32, 2 ** 32 + 1, 2 ** 53, -(2 ** 31), -(2 ** 32), -(2 ** 32) + 1, -(2 ** 53), Infinity, -Infinity, 1].map(pos => code("abc", pos)).join();
}
console.log(deed());
let turns = "";
for (let turn = 0; turn < 40; turn++) turns = deed();
console.log(turns);
