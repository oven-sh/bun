// no loop: the second reader on one way makes the text flat for himself and all that follow, and what follows behind the await is none of them
const table: Record<string, number> = {};
const held = { text: "" };
function made(n: number) {
  return ("\u0100" + "abcdefgh".repeat(n)).slice(1);
}
function fill() {
  let sum = 0;
  for (let i = 0; i < 300; i++) sum += ("\u0100" + String(i % 10).repeat(700 + (i & 63))).slice(1).charCodeAt(3) + ("y" + String(i % 10).repeat(700 + (i & 63))).slice(1).charCodeAt(3);
  return sum;
}
function disturbNow() {
  const found = table[held.text] ?? 0;
  held.text = "";
  Bun.gc(true);
  return found + fill();
}
let size = 90;
function next() {
  size++;
  table["abcdefgh".repeat(size)] = 7;
  held.text = made(size);
}
async function scan(text: string) {
  let h = 0;
  const at = held.text.length - text.length;
  if (at >= 0 && at < text.length) h = text.charCodeAt(at);
  if (at + 1 < text.length && at + 1 >= 0) h = (h * 31 + text.charCodeAt(at + 1)) | 0;
  if (at + 2 < text.length && at + 2 >= 0) h = (h * 31 + text.charCodeAt(at + 2)) | 0;
  await null;
  await null;
  if (at + 3 < text.length && at + 3 >= 0) h = (h * 31 + text.charCodeAt(at + 3)) | 0;
  if (at + 4 < text.length && at + 4 >= 0) h = (h * 31 + text.charCodeAt(at + 4)) | 0;
  return h;
}
async function disturb() {
  await null;
  return disturbNow();
}
async function deed() {
  next();
  const pending = scan(held.text);
  const disturbed = disturb();
  return String(await pending) + ":" + String(await disturbed);
}
console.log(await deed());
for (let i = 0; i < 6; i++) await deed();
console.log(await deed());
