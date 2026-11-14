// Words laid into lines of a width, lines kept in a list and padded
function wrap(text, width) {
  const lines = [];
  let line = "";
  for (const word of text.split(" ")) {
    let rest = word;
    while (rest.length > width) {
      if (line) lines.push(line);
      line = "";
      lines.push(rest.slice(0, width));
      rest = rest.slice(width);
    }
    if (line.length + rest.length + 1 > width && line) {
      lines.push(line);
      line = rest;
    } else line += (line ? " " : "") + rest;
  }
  lines.push(line);
  for (let i = 0; i < lines.length; i++) while (lines[i].length < width) lines[i] += i % 2 ? "." : "_";
  return lines.join("|");
}
console.log(wrap("a few short words here", 8));
console.log(wrap("averyveryverylongword and more", 6));
console.log(wrap("", 3), wrap("a  b", 1));
