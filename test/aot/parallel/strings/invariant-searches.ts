// A search of a string that stays the same in a loop is made once: its answer is passed around the loop.
// STATISTIC: ResultsCarriedAroundLoops >= 4
declare const process: any;
function has(text: string): number { let w = 0; for (let i = 0; i < text.length; i++) { if (text.includes("q")) w += 2; w += i; } return w; }
function goesOnBefore(text: string): number { let w = 0; for (let i = 0; i < text.length; i++) { const c = text.charCodeAt(i); if (c === 32) continue; if (text.includes("quick")) { w += 2; continue; } w += c; } return w; }
function leavesBefore(text: string): number { let w = 0; for (let i = 0; i < text.length; i++) { if (text.charCodeAt(i) === 33) break; if (text.includes("q")) w += 3; w++; } return w; }
function places(text: string, from: number): number { let w = 0; for (let i = 0; i < text.length; i++) w += text.indexOf("w", from) + text.lastIndexOf("w") + i; return w; }
function inOneArm(text: string): number { let w = 0; for (let i = 0; i < text.length; i++) { if (text.charCodeAt(i) > 96) { if (text.includes("q")) w += 3; } else w++; } return w; }
function changes(text: string): number { let w = 0; for (let i = 0; i < 6; i++) { if (text.includes("q")) { w += i; text = text.replace("q", ""); } else w += 100; text += i === 3 ? "q" : "."; } return w; }
function changesInner(text: string): string { let out = ""; for (let i = 0; i < 3; i++) { for (let k = 0; k < 3; k++) { if (k === 1 && i === 1) continue; out += text.indexOf("a", k) + ","; } text = "b" + text; } return out; }
const texts: string[] = ["the quick brown fox", "a word! of wow", "", "wq", "aaa" + String.fromCharCode(0x2603) + "q"];
for (const text of texts) console.log(has(text), goesOnBefore(text), leavesBefore(text), places(text, 2), places(text, -1), inOneArm(text), changes(text), changesInner(text));
