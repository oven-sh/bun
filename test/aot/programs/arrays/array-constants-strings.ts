// Array literals of constant strings, including empty, non-ASCII and repeated strings.
const out: string[] = [];
function codes(a: readonly string[]): string { return a.map(s => s.length + ":" + Array.from(s).map(c => c.codePointAt(0)!.toString(16)).join(".")).join(" "); }
const atTop = ["", "\0", "a", "\x7f", " ", "é", "中", "ab", "\0\0", "once at the top", "twice", "twice"];
const alsoAtTop = ["twice", "", "a", "only here"];
function inFunction(): string[] { return ["", "\0", "z", "\x7f", "é", "😀", "in a function", "twice", "in a function"]; }
function long(): string[] { const a = ["", "\0", "q", "é", "l1", "l2", "l3", "l4", "l5", "l6", "l7", "l8", "l9", "l10", "l11", "l12", "l13", "l14", "twice"]; a[4] = "written"; return a; }
out.push(codes(atTop), codes(alsoAtTop));
for (let i = 0; i < 3; i++) out.push(codes(inFunction()), codes(long()));
out.push(String(atTop[10] === atTop[11]), String(atTop[10] === alsoAtTop[0]), String(inFunction()[7] === "twice"), String("once at the top" === atTop[9]), String(atTop[0] === ""), String(atTop[1] === "\0"), String(atTop[1] === ""));
const keyed: { [k: string]: number } = {}; for (const s of atTop) keyed[s] = (keyed[s] ?? 0) + 1;
out.push(Object.keys(keyed).length + " " + keyed["twice"] + " " + keyed[""] + " " + keyed["\0"]);
console.log(out.join("\n"));
