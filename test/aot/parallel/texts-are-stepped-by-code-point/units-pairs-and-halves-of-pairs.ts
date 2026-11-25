// Each piece that a loop over a text hands out: one code unit below and above 0xFF, pairs of surrogates, halves of pairs in every place, texts that are ropes, texts of one and of no unit; proven texts and texts of which nothing is known.
const lead = "\uD83D", trail = "\uDE00";
const texts: string[] = ["", "a", "ÿĀā", "ab" + lead + trail + "c", lead, trail, lead + lead + trail, trail + lead, lead + "x", "x" + trail, lead + trail + lead, "￿\u0000\u007F\u0080",
  "z".repeat(3) + lead + trail.repeat(2), ["left", "Ж", lead].join("") + [trail, "right"].join("")];
(globalThis as any).shelfOfTexts = { all: texts };
const shelf: any = (globalThis as any).shelfOfTexts;
const show = (piece: string): string => { let codes = ""; for (let at = 0; at < piece.length; at++) codes += (at ? "+" : "") + piece.charCodeAt(at).toString(16); return codes; };
function proven(text: string): string { let out = ""; for (const piece of text) out += show(piece) + ","; return out; }
function unknown(holder: any, at: number): string { let out = ""; for (const piece of holder.all[at]) out += show(piece) + ","; return out; }
function kept(text: string): string[] { const pieces: string[] = []; for (const piece of text) pieces.push(piece); return pieces; }
function same(text: string): boolean { const pieces = kept(text); return pieces.join("") === text && pieces.every(piece => piece.length === (piece.codePointAt(0)! > 0xFFFF ? 2 : 1)); }
function first(text: string): string { for (const piece of text) return show(piece); return "none"; }
function counted(text: string): number { let found = 0; for (const piece of text) if (piece === "z" || piece === lead + trail || piece === "Ж") found++; return found; }
let out = "";
for (let round = 0; round < 3; round++) for (let at = 0; at < texts.length; at++) out += [proven(texts[at]), unknown(shelf, at), same(texts[at]), first(texts[at]), counted(texts[at])].join(" ") + "\n";
console.log(out);
