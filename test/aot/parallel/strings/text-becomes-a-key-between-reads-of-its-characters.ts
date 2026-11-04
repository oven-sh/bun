// a text that is no atom is read by code units in a loop, and one turn uses it as a key that the table has already, which swaps what holds its characters for an atom of the other width, and collects
const table: Record<string, number> = { abcdefgh: 7, "héllo wörld": 9 };
function made(text: string) {
  return ("Ā" + text).slice(1);
}
function fill() {
  let sum = 0;
  for (let i = 0; i < 3000; i++) sum += ("Ā" + String(i % 10).repeat(8)).slice(1).charCodeAt(3);
  return sum;
}
function scan(text: string) {
  let sum = 0;
  for (let i = 0; i < text.length; i++) {
    sum = (sum * 31 + text.charCodeAt(i)) | 0;
    if (i === 2) {
      sum += table[text] ?? 0;
      Bun.gc(true);
      sum += fill();
    }
  }
  return sum;
}
function deed() {
  return [scan(made("abcdefgh")), scan(made("héllo wörld")), scan("abcdefgh"), scan(made("none such"))].join(" ");
}
console.log(deed());
for (let i = 0; i < 20; i++) deed();
console.log(deed());
