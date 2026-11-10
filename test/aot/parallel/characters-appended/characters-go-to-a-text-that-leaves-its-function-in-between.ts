const seen: string[] = [];
function note(text: string): void {
  if (seen.length < 6) seen.push(text);
}
function copy(text: string, every: number): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c !== "-") out += c;
    if (i % every === 0) note(out);
  }
  return out;
}
function words(text: string): string[] {
  const list: string[] = [];
  let word = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === " ") {
      list.push(word);
      word = "";
    } else word += c;
  }
  list.push(word);
  return list;
}
console.log(copy("a-bĀ-c😀-d".repeat(40), 37).length, seen.join("/"));
console.log(words("the quick ЖЖ fox  jumps ÿĀ over").join("|"), words("x".repeat(300) + " " + "中".repeat(300)).map(word => word.length).join());
