// charCodeAt is read off the text that was tested and called on a shorter one
function code(text, other, pos) {
  if (pos < text.length) return String(text.charCodeAt.call(other, pos));
  return "outside";
}
function deed() {
  return code("abcdef", "ab", 4) + "|" + code("abcdef", "ab", 1);
}
console.log(deed());
let turns = "";
for (let turn = 0; turn < 40; turn++) turns = deed();
console.log(turns);
