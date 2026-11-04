// the parameter is stored to through `arguments` between the test and the read
function code(text, pos) {
  if (pos < text.length) {
    arguments[0] = "ab";
    return String(text.charCodeAt(pos));
  }
  return "outside";
}
function deed() {
  return code("abcdef", 4) + "|" + code("abcdef", 1) + "|" + code("ab", 4);
}
console.log(deed());
let turns = "";
for (let turn = 0; turn < 40; turn++) turns = deed();
console.log(turns);
