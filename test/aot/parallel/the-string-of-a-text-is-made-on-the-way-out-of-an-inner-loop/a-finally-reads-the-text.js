// The block of the finally reads the text on both ways.
function spell(text) {
  let i = 0, sum = 0, seen = "", ended = 0;
  try {
    for (i = 0; i < text.length; i++) {
      seen += text[i];
      for (let j = 0; j < 3; j++) sum += j * i;
    }
  } finally { ended = seen.length; }
  return [i, sum, seen, ended].join("|");
}
let last = "";
for (let round = 0; round < 50; round++) last = [spell("a"), spell(""), spell("abc")].join(" || ");
console.log(last);
