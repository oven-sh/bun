// the first reader is a small function that is copied into the coroutine
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
function digest(text: string) {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
  return h;
}
async function scan(text: string) {
  let h = digest(text);
  await null;
  await null;
  return (h * 31 + digest(text)) | 0;
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
