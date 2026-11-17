// Pieces of a text pushed by two loops and joined at two places
function pieces(text) {
  const out = [];
  let line = "";
  for (let i = 0; i < 3; i++) {
    for (let k = 0; k < 4; k++) {
      const c = text[(i * 4 + k) % (text.length || 1)];
      out.push(c);
      line += c;
    }
    out.push("|");
    line = out.join("").length + line;
  }
  return out.join("") + " " + line;
}
console.log(pieces("abcdefghijkl"));
console.log(pieces("xy"));
console.log(pieces(""), pieces([1, 2.5, null]));
