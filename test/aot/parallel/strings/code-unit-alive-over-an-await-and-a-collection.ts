// a character, its comparison and a piece are read in front of an await and a collection and used behind them, in a loop that reads the same text in every turn
async function scan(text: string, turns: number) {
  let hits = 0;
  let last = "";
  for (let i = 0; i < turns; i++) {
    const c = text[i];
    const code = text.charCodeAt(i);
    const piece = text.slice(i, i + 2);
    await null;
    Bun.gc(true);
    if (c === "b") hits += 1;
    if (c === undefined) hits += 100;
    if (code === 98) hits += 10;
    if (piece === "bc") hits += 1000;
    last = piece + String(code) + String(c);
  }
  return hits + ":" + last;
}
function grown(n: number) {
  let text = "";
  for (let i = 0; i < n; i++) text += "abcĀ";
  return text;
}
async function deed() {
  return [await scan("abc", 5), await scan(grown(3), 14), await scan("", 1)].join(" ");
}
console.log(await deed());
for (let i = 0; i < 5; i++) await deed();
console.log(await deed());
