function note(_: string): void { notes++; }
let notes = 0;
(globalThis as any).noters = [note];
function spell(words: string): string {
  let out = "";
  for (let i = 0; i < words.length; i++) {
    const unit = words.charCodeAt(i);
    if (unit === 92) { out += "/"; (globalThis as any).noters[0](out); continue; }
    out += String.fromCharCode(unit + 1);
  }
  return out;
}
let sum = 0;
for (let k = 0; k < 300; k++) sum += spell("abc\\defghij\\klm" + k).length;
console.log(sum, notes, spell("hal\\hal"));
