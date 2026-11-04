// each turn reads characters off a text that the same turn makes longer: a rope that is read, grown and read again
function checksum(seed: string, turns: number) {
  let text = seed;
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    sum = (sum * 31 + text.charCodeAt(i) + text.charCodeAt(text.length - 1)) | 0;
    text += text[i] + String(i % 10) + (i % 7 === 0 ? "Ā" : "z");
    if (text[text.length - 1] === "Ā") sum ^= text.length;
  }
  return sum + ":" + text.length + ":" + text.slice(-6);
}
function deed() {
  return [checksum("a", 1), checksum("ab", 50), checksum("é", 300), checksum("", 3)].join(" ");
}
console.log(deed());
for (let i = 0; i < 20; i++) deed();
console.log(deed());
