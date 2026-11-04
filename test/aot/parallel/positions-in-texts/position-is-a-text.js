// the position is a text, which the relation and the read convert each in its way
function code(text, pos) {
  if (pos < text.length) return String(text.charCodeAt(pos));
  return "outside";
}
function deed() {
  return code("abc", "1") + "|" + code("abc", "-1") + "|" + code("abc", "") + "|" + code("abc", "x") + "|" + code("abc", 2);
}
console.log(deed());
let turns = "";
for (let turn = 0; turn < 40; turn++) turns = deed();
console.log(turns);
