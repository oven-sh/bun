// The length of a character that a loop steps is 1, or 2 above 0xFFFF; a lone surrogate takes 1, and a place outside has none.
function stepped(text: string): string { let units = 0, pairs = 0; for (const c of text) { units += c.length; if (c.length === 2) pairs++; } return units + "/" + pairs; }
function positions(text: string): number[] { const at: number[] = []; let place = 0; for (const c of text) { at.push(place); place += c.length; } return at; }
function byPlace(text: string): number { let n = 0; for (let i = 0; i < text.length + 2; i++) { const c = text[i]; n = n * 3 + (c === undefined ? 0 : c.length); n %= 1000003; } return n; }
function byCharAt(text: string): number { let n = 0; for (let i = -1; i < text.length + 2; i++) n = (n * 3 + text.charAt(i).length) % 1000003; return n; }
function byAt(text: string): number { let n = 0; for (let i = -3; i < text.length; i++) n = (n * 3 + (text.at(i)?.length ?? 2)) % 1000003; return n; }
function kept(text: string): string { let out = ""; for (const c of text) { if (c.length > 1) out += "<" + c + ">"; else out += c + c.length; } return out; }
function listed(text: string): number { let n = 0; for (const c of [...text, "long", ""]) n = n * 5 + c.length; return n; }
function changed(text: string): number { let n = 0; for (let c of text) { if (c === "a") c = "longer"; n = n * 7 + c.length; } return n; }
const texts: string[] = ["", "a", "plain text", "café ☃", "\u{1F600}a\u{1F601}", "\ud83d", "\ude00\ud83d", "a\ud83d😀b", "￿\u{10000}\u{10FFFF}"];
for (const text of texts) console.log(stepped(text), positions(text).join(), byPlace(text), byCharAt(text), byAt(text), JSON.stringify(kept(text)), listed(text), changed(text));
