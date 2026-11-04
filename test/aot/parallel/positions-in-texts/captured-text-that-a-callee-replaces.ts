// a callee stores a shorter text to the captured variable between the test and the read
let text = "abcdef";
function shorten() {
  text = "ab";
}
function code(pos: number): string {
  if (pos < text.length) {
    shorten();
    return String(text.charCodeAt(pos));
  }
  return "outside";
}
function fresh(pos: number): string {
  text = "abcdef";
  return code(pos);
}
function deed(): string {
  return fresh(4) + "|" + fresh(1) + "|" + fresh(6);
}
console.log(deed());
let turns = "";
for (let turn = 0; turn < 40; turn++) turns = deed();
console.log(turns);
