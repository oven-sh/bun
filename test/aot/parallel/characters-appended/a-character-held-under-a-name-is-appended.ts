function copy(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === "," || c === "\n") out += " ";
    else out += c;
  }
  return out;
}
function byMethods(text: string): string {
  let out = "";
  for (let i = -2; i < text.length + 2; i++) {
    const c = text.charAt(i);
    const d = text.at(i);
    out += c;
    if (i & 1) out += d;
    out += "|";
  }
  return out;
}
function pastTheEnd(text: string): string {
  let out = "";
  for (let i = 0; i <= text.length; i++) out += text[i];
  return out;
}
function check(text: string): string {
  let sum = text.length;
  for (let i = 0; i < text.length; i++) sum = (sum * 31 + text.charCodeAt(i)) % 1000003;
  return sum + ":" + text.slice(0, 12);
}
const narrow = "one,two\nthree";
const wide = "Ж,中\n😀\ud83d";
const edge = "þÿĀā,ÿ";
const joined = narrow + JSON.parse('"' + ",tail".repeat(3) + '"');
const long = (narrow + edge).repeat(700);
for (const text of [narrow, wide, edge, joined, long, "", "x", long.slice(3, 4000), wide + long])
  console.log(check(copy(text)), check(byMethods(text)), check(pastTheEnd(text)));
