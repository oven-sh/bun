const unseen = (0, eval)("(x) => x");
function gather(words, mark) {
  const tail = "" + mark;
  let line = "";
  let hits = 0;
  for (let i = 0; i < words.length; i++) {
    if (line.endsWith("," + tail)) hits++;
    line += words[i] + "," + tail;
  }
  return line.length + ":" + hits;
}
let last = "";
for (let turn = 0; turn < 300; turn++) last = gather(unseen(["a", "b", "c"]), unseen("-"));
console.log(last);
