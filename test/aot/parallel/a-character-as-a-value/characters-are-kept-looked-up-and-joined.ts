const weights: Record<string, number> = { a: 1, b: 2, "ÿ": 3, "Ā": 4, "\ud83d": 5 };
const known = new Set(["a", "ÿ", "Ā", "\ude00"]);
const places = new Map<string, number>();
function gather(text: string): string {
  const list: string[] = [];
  let sum = 0;
  let hits = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    list.push(c);
    sum += weights[c] ?? 0;
    if (known.has(c)) hits++;
    places.set(text.charAt(i), i);
    if ("þĀb".includes(c)) hits += 10;
  }
  const last = text[text.length - 1];
  return list.join("|") + " " + sum + " " + hits + " " + list.length + " " + String(last) + " " + typeof text.at(-1);
}
function upper(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) out += text[i]!.toUpperCase() + text.charAt(i).charCodeAt(0).toString(16);
  return out;
}
for (const text of ["ab", "þÿĀā", "x😀y", "", "a".repeat(3) + JSON.parse('"b\\u0416"')]) console.log(gather(text), upper(text));
console.log([...places].map(([c, i]) => c.charCodeAt(0) + ":" + i).join());
