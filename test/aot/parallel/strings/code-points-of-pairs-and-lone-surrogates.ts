// codePointAt, charCodeAt, at and an index walk texts of pairs, lone leads, lone trails, a lead at the very end, in flat texts, ropes and pieces
function walk(s: string) {
  const out: string[] = [];
  for (let i = -1; i <= s.length; i++) out.push(String(s.codePointAt(i)) + "/" + String(s.charCodeAt(i)) + "/" + JSON.stringify(s.at(i)) + "/" + JSON.stringify(s[i]) + "/" + (s[i] === "\ud83d") + "/" + (s.charAt(i) > "\udbff"));
  return out.join(" ");
}
function rope(a: string, b: string, n: number) {
  let text = "";
  for (let i = 0; i < n; i++) text += i % 2 ? a : b;
  return text;
}
function deed() {
  return [walk("😀"), walk("\ud83d"), walk("\ude00\ud83d"), walk("a\ud83d"), walk("\ud83d😀\ude00"), walk(rope("\ud83d", "\ude00", 5)), walk(rope("x\ud83d", "\ude00y", 9).slice(1, 8))].join("\n");
}
console.log(deed());
for (let i = 0; i < 20; i++) deed();
console.log(deed() === deed());
