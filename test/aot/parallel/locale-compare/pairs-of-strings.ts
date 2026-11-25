// localeCompare of all pairs of strings: short and long, equal beginnings, case, punctuation, controls, Latin-1, two-byte, ropes and substrings, on receivers that the build knows and does not know.
// @ts-nocheck
const list: string[] = ["ayb9os*@a\tb\x01a", "ayb9os*@ab\u0100bbab\u0100a\u0100ba\u0100\u0100b\u0100", "ayb9os*@aofoooofffofofooooffooofo", "ayb9os*@a_aab.", "ayb9os*@aa0120cc00", "ayb9os*@a ", "ayb9os*@a", "aa-\u0100\x7fà1y2", "aa-\u0100\x7fà1y\u00ad\u00ada\u00ad\u00ad\u00ad\u00ad\u00ad", "aa-\u0100\x7fà1yaaa\u00adaa\u00ad\u00ada", "aa-\u0100\x7fà1yababaaabbab", "aa-\u0100\x7fà1y\"aaa'\"\"", "aa-\u0100\x7fà1ya\u0301bbaaabbaa\u0301aab", "aa-\u0100\x7fà1y", "obfaazaßsß", "obfaaza822690836308389", "obfaaza6719", "obfaazaaaBabaaA", "obfaazaa  aa", "obfaazaofoooofo", "obfaaza", "y\u0100a5\u00ad\u00ad\u00ad", "y\u0100a5z\x7fxyyzyy", "y\u0100a58938639287631120", "y\u0100a5bbaaaaba", "y\u0100a5.;%*", "y\u0100a5#;+]9={&?z]~:/)ZZ}$@~!>(&==.!&,", "y\u0100a5", "_aéaÀbfssa\u0100aa\u0100ababab", "_aéaÀbfssaaa\u00ad", "_aéaÀbfss  aa", "_aéaÀbfsséaéa", "_aéaÀbfss ", "_aéaÀbfss aA.A.", "_aéaÀbfss", "", "foo1", "foo10", "foo100", "foo2", "Foo1", "fOO100"];
const K = JSON.parse("1"); const any: any[] = JSON.parse(JSON.stringify(list));
const made: string[] = list.map((s, k) => k % 4 === 0 ? s.slice(0, s.length >> 1) + s.slice(s.length >> 1) : k % 4 === 1 ? ("<" + s + ">").slice(1, -1) : k % 4 === 2 ? ("\u1234" + s).slice(1) : s.split("").join(""));
function cmp(a: string, b: string): number { return a.localeCompare(b); }
function unknown(a, b) { return a.localeCompare(b); }
class Sign { value: string; constructor(value: string) { this.value = value; } compareTo(other: Sign): number { return this.value.localeCompare(other.value); } }
const signs = made.map(s => new Sign(s));
function table(f: (i: number, j: number) => number): string { let t = ""; for (let i = 0; i < list.length; i++) { let row = 0, sum = 0; for (let j = 0; j < list.length; j++) { const c = f(i, j); row = (row * 31 + (c < 0 ? 1 : c > 0 ? 2 : Object.is(c, 0) ? 3 : 4)) | 0; sum += c; } t += row.toString(36) + ":" + sum + " "; } return t; }
for (let round = 0; round < 2; round++) {
console.log(table((i, j) => cmp(list[i]!, list[j]!)));
console.log(table((i, j) => unknown(any[i], any[j])));
console.log(table((i, j) => cmp(made[i]!, list[j]!)));
console.log(table((i, j) => signs[i]!.compareTo(signs[j]!)));
console.log(table((i, j) => unknown(made[i], any[j])));
console.log(JSON.stringify([...made].sort((a, b) => a.localeCompare(b))));
console.log(JSON.stringify([...any].sort(unknown)));
let lows = 0; for (let i = 0; i < list.length; i++) for (let j = 0; j < list.length; j++) { const c = made[i]!.localeCompare(made[j]!); if (c < 0) lows++; else if (c > 0) lows += 2; else lows += 7; } console.log(lows);
}
try { console.log(unknown("a", 1), unknown("a", undefined), unknown("true", true), unknown("b", { toString() { return "a"; } })); } catch (e) { console.log(e.name); }
export {};
