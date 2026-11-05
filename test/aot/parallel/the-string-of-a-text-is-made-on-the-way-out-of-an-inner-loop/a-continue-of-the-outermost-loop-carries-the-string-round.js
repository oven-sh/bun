function spell(words) {
  let last = "", sum = 0;
  outer: for (let w = 0; w < words.length; w++) {
    const text = words[w];
    let seen = "";
    for (let i = 0; i < text.length; i++) {
      seen += text[i];
      for (let j = 0; j < 3; j++) {
        if (i === 2 && j === 1) { last = seen; continue outer; }
        sum += j * i;
      }
    }
    last = seen + ".";
  }
  return [sum, last].join("|");
}
let shown = "";
for (let round = 0; round < 50; round++) shown = [spell(["ab", "x", "abcd"]), spell(["abcd", "ab"]), spell([])].join(" || ");
console.log(shown);
