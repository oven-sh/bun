let word = "w";
function fill(bound) {
  const out = [];
  for (let at = 0; at < bound; at++) out[at] = word + at + word;
  return out;
}
const filled = fill(3000);
console.log(filled.length, filled[0], filled[2999], filled.join("").length);
