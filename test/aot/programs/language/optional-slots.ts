declare const console: { log(...values: unknown[]): void };
const text = "abcdefghijklmnopqrstuvwxyz";
const given: number[] = [0, -0, 1, 2, 25, 26, -1, 3.5, 2147483647, -2147483648, 2147483648, 4294967296, 1e21, NaN, Infinity, -Infinity];
function holed(): number[] { const a = given.slice(); delete (a as unknown[])[2]; return a; }
function show(v: unknown): string { return typeof v === "number" ? (Object.is(v, -0) ? "-0" : String(v)) : typeof v + ":" + String(v); }
function codes(a: number[]): string { let s = ""; for (let i = 0; i < a.length + 1; i++) s += show(text.charCodeAt(a[i])) + ","; return s; }
function points(a: number[]): string { let s = ""; for (let i = 0; i < a.length + 1; i++) s += show(text.codePointAt(a[i])) + ","; return s; }
function letters(a: number[]): string { let s = ""; for (let i = 0; i < a.length + 1; i++) s += show(text[a[i]]) + ","; return s; }
function lettersAt(a: number[]): string { let s = ""; for (let i = 0; i < a.length + 1; i++) s += show(text.at(a[i])) + "," + show(text.charAt(a[i])) + ","; return s; }
function parts(a: number[]): string { let s = ""; for (let i = 0; i < a.length; i++) s += text.slice(a[i], a[i + 1]).length + "," + text.substring(a[i], a[i + 1]).length + ","; return s; }
function gathered(a: number[], b: number[]): string { let s = ""; for (let i = 0; i < a.length + 1; i++) s += show(b[a[i]]) + ","; return s; }
function scattered(a: number[]): string { const b: number[] = [9, 9, 9, 9]; for (let i = 0; i < 5; i++) b[a[i]] = i; return b.map(show).join() + " " + Object.keys(b).join(); }
function taken(a: number[], b: number[]): string { let s = ""; for (let i = 0; i < a.length + 1; i++) s += show(b.at(a[i])) + "," + b.slice(a[i]).length + "," + b.indexOf(2, a[i]) + ","; return s; }
function padded(a: number[]): string { let s = ""; for (let i = 0; i < 6; i++) s += "x".padStart(a[i] % 7).length + "," + "ab".repeat(Math.abs(a[i]) % 3).length + ","; return s; }
function fixed(a: number[]): string { let s = ""; for (let i = 0; i < 5; i++) s += (1.23456).toFixed(a[i]) + ","; return s; }
function one(a: number[], i: number): string { return show(text.charCodeAt(a[i])) + show(text[a[i]]) + show(a[a[i]]); }
function shifted(a: number[]): string { let s = ""; for (let i = 0; i < a.length + 1; i++) s += (1 << a[i]) + "," + (a[i] | 0) + "," + (a[i] >>> 0) + ","; return s; }
for (let turn = 0; turn < 2; turn++) {
    for (const [name, make] of [["given", () => given.slice()], ["holed", holed], ["parsed", () => JSON.parse("[0,1,2,25,26,-1]") as number[]], ["none", (): number[] => []]] as [string, () => number[]][]) {
        const say = (what: string, run: () => string) => { let said: string; try { said = run(); } catch (e) { said = e instanceof TypeError ? "TypeError" : e instanceof RangeError ? "RangeError" : "threw"; } console.log(name + " " + what + ": " + said); };
        say("codes", () => codes(make())); say("points", () => points(make())); say("letters", () => letters(make())); say("lettersAt", () => lettersAt(make())); say("parts", () => parts(make()));
        say("gathered", () => gathered(make(), [10, 11.5, 12])); say("gathered whole", () => gathered(make(), JSON.parse("[7,8,9]") as number[])); say("scattered", () => scattered(make())); say("taken", () => taken(make(), [1, 2, 3, 2]));
        say("padded", () => padded(make())); say("fixed", () => fixed(make())); say("shifted", () => shifted(make())); say("one", () => [0, 2, 5, 13, 99].map(i => one(make(), i)).join(" "));
    }
}
