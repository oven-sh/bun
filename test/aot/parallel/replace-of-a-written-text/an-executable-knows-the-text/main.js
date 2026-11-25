const written = ["quire".replace(/^/, "re"), "requir".replace(/$/, "e"), ("b" + "c").replace(/^/, `a`), "".replace(/$/, ""), "a\nb".replace(/$/, "!")];
console.log(written.join("|"));
function mark(turns) {
  let length = 0;
  for (let turn = 0; turn < turns; turn++) length += "abc".replace(/$/, "!").length + "abc".replace(/^/, "!!").length;
  return length;
}
console.log(mark(300), typeof "abc".replace(/$/, "!"), "abc".replace(/$/, "!") === "abc!");
