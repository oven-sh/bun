// Lines of growing length, built of pieces that are pushed and joined
function stairs(mark, gap) {
  const lines = [];
  for (let y = 1; y <= 4; y++) {
    const pieces = [];
    for (let x = 0; x < 4; x++) {
      pieces.push(x < y ? mark : gap);
    }
    pieces.push(String(y));
    lines.push(pieces.join(""));
    lines.push(lines[0].length + y);
  }
  return lines.join("/");
}
console.log(stairs("#", "."));
console.log(stairs("<>", " "));
console.log(stairs("", "-"));
