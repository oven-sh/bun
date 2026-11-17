// A text that a loop grows and compares with a written text: before and behind the growth, with both operators, negated, in a condition, as a value, with a text of no, of one and of wide characters.
function count(n: number): number { let s = "", c = 0; for (let i = 0; i < n; i++) { s += "ab"; if (s === "abab") c++; } return c; }
function value(n: number): string { let s = ""; const o: boolean[] = []; for (let i = 0; i < n; i++) { o.push(s === "", s === "a", s === "aa", s == "aaa", "aa" === s, s !== "a", s != "aa"); s += "a"; } return o.map(b => b ? "1" : "0").join(""); }
function leave(words: string[]): number { let s = ""; let i = 0; for (const w of words) { s += w; i++; if (s === "thequick") return i; } return -1; }
function wide(n: number): string { let s = "", o = ""; for (let i = 0; i < n; i++) { s += i & 1 ? "Ā" : "x"; if (s === "xĀ") o += "w" + i; else if (s === "xĀx") o += "W" + i; } return o + s; }
function narrowed(n: number): string { let s = "", o = ""; for (let i = 0; i < n; i++) { s += "a"; const two: string = s; if (two === "aa") o += two + two.length; else if (two !== "aaa") o += "-"; } return o; }
function both(n: number): string { let s = "", t = "", o = ""; for (let i = 0; i < n; i++) { s += "a"; t += "ab"; if (s === "aa" && t === "abab") o += "B"; if (s === "aaa" || t === "ab") o += "E"; } return o + s.length + t.length; }
function again(n: number): string { let s = "", o = ""; for (let i = 0; i < n; i++) { s += "a"; if (s === "aa") { o += s; s += "b"; } if (s === "aab") o += "!" + s; } return o + s; }
function chosen(n: number): string { let s = "", o = ""; for (let i = 0; i < n; i++) { s += "a"; switch (s) { case "a": o += 1; break; case "aa": o += 2; break; case "": o += 0; break; default: o += "d"; } } return o; }
function anew(words: string[]): string { let s = "", o = ""; for (const w of words) { s += w; if (s === "aa") { o += "|"; s = ""; } } return o + s; }
function handled(words: string[]): string { let s = "", o = ""; for (const w of words) { try { s += w; if (s === "ab") throw s; o += s.length; } catch (e) { o += "c" + e; s = ""; } } return o + s; }
function notText(n: number): string { let s: any = 1, o = ""; for (let i = 0; i < n; i++) { if (s === "1x") o += "T"; if (s === 1) o += "N"; s += "x"; } return o + s; }
function joined(n: number): string { let s = "", o = 0; for (let i = 0; i < n; i++) { if (s + "b" === "aab") o++; s += "a"; } return s + o; }
const known: string = ["abab"].join("");
function unknown(n: number): number { let s = "", c = 0; for (let i = 0; i < n; i++) { s += "ab"; if (s === known) c++; } return c; }
for (let k = 0; k < 3; k++) {
  console.log(count(0), count(1), count(2), count(50), value(5), leave(["the", "quick", "fox"]), leave(["a"]), wide(6), narrowed(5));
  console.log(both(4), again(4), chosen(4), anew(["a", "a", "b", "a", "aa"]), handled(["a", "b", "c", "ab"]), notText(3), joined(4), unknown(9));
}
