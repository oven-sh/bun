// two reads of characters stand in front of an await and two behind it, and while the reader is suspended the text becomes a key, which swaps what holds its characters, and the heap is collected with the text on no stack
const table: Record<string, number> = { abcdefgh: 7 };
const held = { text: "" };
function made(text: string) {
  return ("Ā" + text).slice(1);
}
function fill() {
  let sum = 0;
  for (let i = 0; i < 3000; i++) sum += ("Ā" + String(i % 10).repeat(8)).slice(1).charCodeAt(3);
  return sum;
}
async function scan(text: string, at: number) {
  const front = text.charCodeAt(at) * 3 + text.charCodeAt(at + 1);
  await null;
  await null;
  await null;
  return front * 31 + text.charCodeAt(at + 2) * 3 + text.charCodeAt(at + 3);
}
async function disturb() {
  const found = table[held.text] ?? 0;
  held.text = "";
  await null;
  Bun.gc(true);
  return found + fill();
}
async function deed() {
  held.text = made("abcdefgh");
  const pending = scan(held.text, 0);
  const disturbed = disturb();
  return String(await pending) + ":" + String(await disturbed);
}
console.log(await deed());
for (let i = 0; i < 20; i++) await deed();
console.log(await deed());
