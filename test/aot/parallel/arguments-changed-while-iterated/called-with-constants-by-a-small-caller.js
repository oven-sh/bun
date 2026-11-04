function joined() {
  let text = "";
  for (const value of arguments) {
    arguments[2] = "Z";
    text += value;
  }
  return text;
}
function caller(last) {
  return joined("a", "b", last);
}
let text = "";
for (let turn = 0; turn < 40; turn++) text = caller("c" + turn);
console.log(text);
