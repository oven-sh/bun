// `text += piece` in a loop. The run time writes the pieces behind the text in a buffer with room. No string may change by that: whoever has read, kept, compared or used an earlier state of the text goes on seeing that state.
let log = "";
const sink: unknown[] = []; (globalThis as any).sinkOfTexts = sink;
function digest(s: string): string { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return s.length + ":" + h + ":" + s.slice(0, 12) + ".." + s.slice(-12); }

function plain(n: number): string { let text = ""; for (let i = 0; i < n; i++) text += "k" + i + ","; return text; }
function readInTheMiddle(n: number): string { let text = "", seen = ""; for (let i = 0; i < n; i++) { text += "k" + i + ","; if (i % 7 === 3) seen += text.length + ":" + text.charCodeAt(text.length - 2) + ":" + text.slice(-4) + ";"; } return digest(text) + "|" + digest(seen); }
function keptStates(n: number): string { const kept: string[] = []; let text = ""; for (let i = 0; i < n; i++) { if (i % 5 === 0) kept.push(text); text += i + "-"; } return kept.map(digest).join() + "|" + digest(text); }
function keptInClosures(n: number): string { const readers: (() => string)[] = []; let text = ""; for (let i = 0; i < n; i++) { const now = text; if (i % 6 === 0) readers.push(() => now); text += "<" + i + ">"; } return readers.map(r => digest(r())).join() + "|" + digest(text); }
function capturedItself(n: number): string { let text = ""; const read = () => text; let seen = ""; for (let i = 0; i < n; i++) { text += i + ","; if (i % 9 === 0) seen += read().length + ";"; } return digest(text) + "|" + seen; }
function compared(n: number): string { let text = "", before = "", equal = 0, less = 0; for (let i = 0; i < n; i++) { before = text; text += "a" + (i % 3); if (text === before + "a" + (i % 3)) equal++; if (before < text) less++; if (text === before) equal += 1000; } return equal + "," + less; }
function usedAsKey(n: number): string { const table: Record<string, number> = {}; const map = new Map<string, number>(); let text = ""; for (let i = 0; i < n; i++) { text += i % 10; table[text] = i; map.set(text, i); } let sum = 0, probe = ""; for (let i = 0; i < n; i++) { probe += i % 10; sum += table[probe] + map.get(probe)!; } return Object.keys(table).length + "," + map.size + "," + sum; }
function forks(n: number): string { let text = ""; const out: string[] = []; for (let i = 0; i < n; i++) { text += "x" + i; const left = text + "L", right = text + "R"; if (i % 8 === 0) out.push(left, right); } return out.map(digest).join() + "|" + digest(text); }
function olderStateGrowsAgain(n: number): string { let text = "", old = ""; for (let i = 0; i < n; i++) { if (i === 3) old = text; text += "a" + i; } let other = old; for (let i = 0; i < n; i++) other += "b" + i; return digest(text) + "|" + digest(other) + "|" + digest(old); }
function twoTexts(n: number): string { let a = "", b = ""; for (let i = 0; i < n; i++) { a += i + "a"; b += a.length + "b"; if (i % 4 === 0) { const t = a; a = b; b = t; } } return digest(a) + "|" + digest(b); }
function throughJoins(rows: number[][]): string { let out = ""; for (const row of rows) { let line = ""; for (const c of row) { if (line) line += ","; line += c; } out += line + "\n"; } return digest(out); }
function otherThings(n: number): string { let text = ""; const things: unknown[] = [1.5, -0, NaN, Infinity, true, false, null, undefined, 12345678901, -7, 2147483647, -2147483648, 10n, "", "é", "\u{1F600}", "日本"]; for (let i = 0; i < n; i++) text += things[i % things.length] + "|"; return digest(text); }
function integers(n: number): string { let text = ""; for (let i = -n; i < n; i += 37) text += i; for (const i of [0, -1, 9, 10, 99, 100, 2147483647, -2147483648, 1000000000, -1000000000]) text += i + ","; return digest(text); }
function wide(n: number): string { let text = ""; for (let i = 0; i < n; i++) text += (i === n >> 1 ? "中" : "a") + i; return digest(text); }
function wideFromTheStart(n: number): string { let text = "中"; for (let i = 0; i < n; i++) text += i + "é"; return digest(text); }
function beginsLong(n: number): string { let text = "z".repeat(5000); for (let i = 0; i < n; i++) text += i + "."; return digest(text); }
function withEffects(n: number): string { log = ""; let text = ""; const o = { toString() { log += "s"; return "S" + text.length; } }, v = { valueOf() { log += "v"; text += "!"; return 7; } }; for (let i = 0; i < n; i++) { text += "a" + o + i; text += v as any; text += `${o}`; } return digest(text) + "|" + log.length; }
function throwsInTheMiddle(n: number): string { let text = ""; const bad = { toString() { throw new RangeError("no"); } }; try { for (let i = 0; i < n; i++) text += "p" + i + (i === n - 2 ? bad : ""); } catch (e) { return digest(text) + "|" + (e as Error).name; } return "no throw"; }
function symbolAdded(n: number): string { let text = ""; try { for (let i = 0; i < n; i++) text += (i === 5 ? Symbol.iterator as any : i); } catch (e) { return digest(text) + "|" + (e as Error).name; } return "no throw"; }
function notAText(n: number): string { let x: any = 0; for (let i = 0; i < n; i++) x += i; let y: any = 1; for (let i = 0; i < n; i++) y += i === 3 ? "s" : i; return x + "|" + y; }
function prepends(n: number): string { let text = ""; for (let i = 0; i < n; i++) text = i + "," + text; return digest(text); }
function replacedEachTurn(list: string[]): string { let cur = "", out = ""; for (const s of list) { out = cur + "x"; cur = s; } return out + "|" + cur; }
function handedOut(n: number): string { let text = ""; for (let i = 0; i < n; i++) { text += i + ";"; sink.push(text); } const all = (sink as string[]).map(s => s.length).join(); sink.length = 0; return digest(all) + "|" + digest(text); }
function* yielded(n: number): Generator<string> { let text = ""; for (let i = 0; i < n; i++) { text += i + ":"; yield text; } }
async function awaited(n: number): Promise<string> { let text = ""; for (let i = 0; i < n; i++) { text += i + "~"; if (i % 3 === 0) await null; } return digest(text); }
function substringsAndSplits(n: number): string { let text = ""; for (let i = 0; i < n; i++) text += "w" + i + " "; return text.split(" ").length + "," + text.indexOf("w7 ") + "," + text.lastIndexOf("w") + "," + text.trim().length + "," + text.toUpperCase().slice(0, 9) + "," + JSON.stringify(text).length + "," + text.replace(/w/g, "").length + "," + [...text].length; }

const rows: number[][] = []; for (let r = 0; r < 9; r++) { const row: number[] = []; for (let c = 0; c < 7; c++) row.push(r * c - 3); rows.push(row); }
for (const n of [0, 1, 2, 16, 40, 700, 3000]) {
  console.log(n, digest(plain(n)), readInTheMiddle(n), digest(keptStates(n)), digest(keptInClosures(n)), capturedItself(n).length, compared(n), usedAsKey(Math.min(n, 400)));
  console.log(n, digest(forks(n)), olderStateGrowsAgain(n), twoTexts(n), otherThings(n), integers(n), wide(n), wideFromTheStart(n), beginsLong(n));
  console.log(n, withEffects(Math.min(n, 60)), throwsInTheMiddle(n), symbolAdded(n), digest(notAText(n)), prepends(n), handedOut(Math.min(n, 300)), digest([...yielded(Math.min(n, 200))].join("/")), substringsAndSplits(n));
}
console.log(throughJoins(rows), throughJoins([]), throughJoins([[], [1], []]), replacedEachTurn(["a", "bb", "c".repeat(900), "d"]));
awaited(50).then(console.log);
