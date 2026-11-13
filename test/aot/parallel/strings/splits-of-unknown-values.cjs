// What a split of a value of no known class gives is expected to be an array: a loop over it asks once. Whatever else comes, or becomes of the array in between, is read as it is.
// STATISTIC: ArraysExpectedOfSplits >= 1
const log = [];
function letters(text) { var parts = text.split(""), i = 0, n = 0; while (parts[i]) { if (parts[i] == "b") n++; i++; } return n + "/" + i; }
function replaced(text, table) { var parts = text.split(""), i = 0; while (parts[i]) { if (parts[i] == "\\") parts.splice(i, 1); else { var f = table[parts[i]]; if (f) parts[i] = f(parts); } i++; } return parts.join("") + parts.length; }
function words(text, by) { const parts = text.split(by); let s = ""; for (let i = 0; i < parts.length; i++) s += "<" + parts[i] + ">"; return s; }
function last(text) { let found; for (const part of text.split(",")) found = part; return found; }
function summed(text) { const parts = text.split(","); let n = 0; for (let i = 0; i < parts.length; i++) n += +parts[i]; return n; }
const table = {
    a() { return "A"; }, b(parts) { parts.length = 2; return "B"; }, c(parts) { parts[40] = "far"; return 1.5; }, d(parts) { Object.defineProperty(parts, "1", { get() { return "got"; }, configurable: true }); return null; },
    e(parts) { Object.freeze(parts); return "frozen"; }, f(parts) { if (parts.length < 8) parts.unshift("first"); return { toString: () => "object" }; }, g(parts) { Object.setPrototypeOf(parts, { __proto__: Array.prototype, 5: "inherited" }); return "g"; }
};
class Lines { constructor(n) { this.n = n; } split(by) { return by === "" ? { 0: "b", 1: "x", 2: "b", splice() { }, join: () => "joined", length: 3, [Symbol.iterator]: Array.prototype[Symbol.iterator] } : new Proxy(["p", "q"].slice(0, this.n), { get: (t, k) => k === "0" ? "trapped" : t[k] }); } }
const values = ["abcab", "", "xyz", "a\\bc", "baaab", "cab", "dabc", "eab", "fab", "gabcdefgh", new String("abba"), new Lines(2), new Lines(0), { split: () => "bab" }, { split: () => new Uint8Array([1, 2, 3]) }, { split: () => null }, { split: () => [, "b", , "b"] }, 12, null, undefined, "1,2,3", "1,,x", "жб,日本"];
const run = f => { try { log.push(String(f())); } catch (e) { log.push(e.name + ": " + e.message); } };
for (let turn = 0; turn < 3; turn++)
    for (const value of values) {
        run(() => letters(value)); run(() => replaced(value, table)); run(() => last(value)); run(() => summed(value));
        for (const by of ["", "a", ",", /[ab]/, undefined, { [Symbol.split]: text => ["by", text] }]) run(() => words(value, by));
    }
run(() => letters("bbb"));
console.log(log.join("\n"));
