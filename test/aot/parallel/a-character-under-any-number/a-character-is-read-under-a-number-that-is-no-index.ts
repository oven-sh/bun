function read(text: string, places: number[]): string {
  let out = "";
  for (let k = 0; k < places.length; k++) {
    const c = text[places[k]!];
    out += c === undefined ? "_" : c === "b" ? "B" : c;
  }
  return out;
}
function stepping(text: string, step: number): string {
  let out = "";
  for (let i = 0; i < text.length; i += step) {
    if (text[i] !== "-") out += text[i];
    if (text[i + step] === "-") i += step * 2 - step;
  }
  return out;
}
function skipping(line: string): string {
  let out = "";
  for (let i = 0; i < line.length; i++) {
    if (line[i] !== "`") {
      out += line[i];
      continue;
    }
    let ticks = 1;
    while (line[i + ticks] === "`") ticks++;
    i += ticks - 1;
  }
  return out;
}
const places = [0, -0, 1, 2, 3, -1, 0.5, 1.5, NaN, Infinity, -Infinity, 2147483647, 2147483648, 4294967296, 4294967297, 9007199254740992, 1e21, -2147483648, -4294967295, 1 / 3, 2.0000000000000004];
console.log(read("abc", places), read("Жb\ud83d", places), read("", places));
console.log(stepping("ab-cd-ef-gh", 1), stepping("ab-cd-ef-gh", 0.5), stepping("ab-cd-ef-gh", 1.5), stepping("ab-cd-ef-gh", 4294967296), stepping("ab-cd-ef-gh", Infinity));
console.log(skipping("a`b``c```d````"), skipping("````"), skipping("no ticks"), skipping("Ж`中``"));
