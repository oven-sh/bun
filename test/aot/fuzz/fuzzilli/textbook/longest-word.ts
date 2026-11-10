function longest(text: string): string {
  let best = "";
  let word = "";
  for (let i = 0; i <= text.length; i++) {
    if (i === text.length || text[i] === " ") {
      if (word.length > best.length) best = word;
      word = "";
    } else word += text[i];
  }
  return best;
}
console.log(longest(JSON.parse('"the quick brownish fox"')), longest("") === "");
