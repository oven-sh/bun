// A text built of elements in two levels, its parts pushed
function labels(list) {
  let text = "";
  const parts = [];
  for (let i = 0; i < 3; i++) {
    let line = "";
    for (let k = 0; k < 2; k++) {
      line += list[k] + (k ? "" : "-");
      parts.push(line.length);
    }
    text += line + list[i] + ";";
    parts.push(text.length);
  }
  return text + " " + parts.join();
}
console.log(labels(["a", "b", "c"]));
console.log(labels([1, 2.5, null]));
console.log(labels(["", "xx", "é"]), labels([undefined, true, 10n]));
