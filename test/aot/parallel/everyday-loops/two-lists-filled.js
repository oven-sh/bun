// Two lists filled from one nest of loops; the second by index
function split(words) {
  const letters = [];
  const at = [];
  for (let i = 0; i < words.length; i++) {
    for (let k = 0; k < words[i].length; k++) {
      if (words[i][k] === " ") continue;
      letters.push(words[i][k]);
      at[letters.length - 1] = i * 100 + k;
    }
    at[letters.length] = -1;
  }
  return letters.join("") + " " + at.join() + " " + at.length;
}
console.log(split(["ab", "c d", ""]));
console.log(split(["  x", "yz", " "]));
console.log(split([["p", "q"], "r"]));
