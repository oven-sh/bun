const unseen = (0, eval)("(x) => x");
function gather(count) {
  let line = "";
  let seen = 0;
  for (let i = 0; i < count; i++) {
    const [before, k] = [line, i];
    line += "k" + k;
    seen += before.length;
  }
  return line + "/" + seen;
}
console.log(gather(unseen(3)));
