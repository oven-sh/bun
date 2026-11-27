// A string built of strings that an inner loop builds
function box(width, height, mark) {
  let text = "";
  for (let y = 0; y < height; y++) {
    let line = y % 2 ? ">" : "";
    for (let x = 0; x < width; x++) {
      if ((x + y) % 3 === 0) line += mark;
      else line = x + line;
    }
    text += line + (y < height - 1 ? "/" : "");
  }
  return text + " " + text.length;
}
console.log(box(5, 3, "#"));
console.log(box(3, 4, 1.5));
console.log(box(0, 2, "x"), box(12, 1, null));
