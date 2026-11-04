function changedEachTime() {
  let text = "";
  for (const value of arguments) {
    arguments[2] = "Z";
    text += value;
  }
  return text;
}
let all = 0;
let last = "";
for (let turn = 0; turn < 300; turn++) {
  last = changedEachTime("a", "b", "c" + turn);
  if (last === "abZ") all++;
}
console.log(all, last);
