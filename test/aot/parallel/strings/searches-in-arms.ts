// The answer of a search in an arm is passed on where the arms meet.
// STATISTIC: ResultsCarriedAroundLoops >= 5
function inArm(text: string): number { let w = 0; for (let i = 0; i < text.length; i++) { if (text.charCodeAt(i) > 96) { if (text.includes("q")) w += 3; } else w++; } return w; }
function inArms(text: string): number { let w = 0; for (let i = 0; i < text.length; i++) { const c = text.charCodeAt(i); if (c === 32) w += text.indexOf("o"); else if (c > 110) w -= text.lastIndexOf("o"); else if (c > 100) { w += text.includes("ow") ? 2 : 5; } else continue; w += i; } return w; }
function inSwitch(text: string): number { let w = 0; for (let i = 0; i < text.length; i++) { switch (text.charCodeAt(i) & 3) { case 0: w += text.indexOf("u"); case 1: w++; break; case 2: if (text.includes("i")) break; w += 7; break; default: continue; } w *= 3; w %= 1000003; } return w; }
function nested(text: string): number { let w = 0; for (let i = 0; i < 4; i++) { for (let k = 0; k < text.length; k++) { if (k > i) { if (text.includes("n")) w += k; } } if (i === 1) { w += text.indexOf("w"); continue; } w += i; } return w; }
function unrolled(text: string): number { let w = 0; for (let i = 0; i < 30; i++) { for (const at of [1, 2, 3]) if (at !== i % 5) w += text.indexOf("q", at); w ^= i; } return w; }
function caught(text: string): number { let w = 0; for (let i = 0; i < 20; i++) { try { if (i % 4 === 1) throw i; if (i % 3) w += text.indexOf("x"); } catch { w += 2; if (i % 2) w += text.indexOf("o"); } w += 1; } return w; }
function changes(text: string): number { let w = 0; for (let i = 0; i < 9; i++) { if (i % 2) { if (text.includes("q")) { w += i; text = text.replace("q", ""); } } else w += 100; text += i === 3 ? "q" : "."; } return w; }
const texts: string[] = ["the quick brown fox", "a word! of wow", "", "wq", "nnn" + String.fromCharCode(0x2603) + "q", "x".repeat(40)];
for (const text of texts) console.log(inArm(text), inArms(text), inSwitch(text), nested(text), unrolled(text), caught(text), changes(text));
