// the text is a String object
function codes(text) {
  let seen = "";
  for (let pos = 0; pos < text.length; pos++) seen += text.charCodeAt(pos) + "," + text[pos] + ";";
  return seen;
}
function deed() {
  return codes(new String("abc")) + "|" + codes("abc") + "|" + codes(Object(""));
}
console.log(deed());
let turns = "";
for (let turn = 0; turn < 40; turn++) turns = deed();
console.log(turns);
