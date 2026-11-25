function inside(rows: number, columns: number): string {
  let cell = "";
  let out = "";
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      cell += column;
      if (column % 3 === 2) {
        out += "[" + cell + "]";
        cell = "";
      }
    }
    out += "\n";
  }
  return out + cell;
}
function underHandler(count: number, failsAt: number): string {
  let text = "";
  let seen = "";
  for (let i = 0; i < count; i++) {
    try {
      text += i;
      if (i === failsAt) throw new Error("at " + i);
      if (i % 4 === 3) {
        seen += text + ";";
        text = "";
      }
    } catch (error) {
      seen += "(" + text + " " + (error as Error).message + ")";
      text = "!";
    }
  }
  return seen + text;
}
console.log(inside(3, 7));
console.log(underHandler(14, 6));
