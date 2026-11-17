// Loops over the characters of texts that a turn around reads off a list nobody types.
// STATISTIC: ArrayOrStringLoopsVersioned >= 4
const said = []; let digest = 0, cases = 0, calls = 0;
const tells = process.argv[2] === "all";
function keep(text) { cases++; if (tells) console.log(text.slice(0, 260)); for (let i = 0; i < text.length; i++) digest = (digest * 31 + text.charCodeAt(i)) | 0; if (cases % 97 === 1) said.push(text.slice(0, 170)); }
function show(x) { try { return typeof x === "number" ? Object.is(x, -0) ? "-0" : String(x) : typeof x === "string" ? JSON.stringify(x) : typeof x === "bigint" ? x + "n" : x === undefined ? "u" : x === null ? "n" : Array.isArray(x) ? "[" + Array.from({ length: Math.min(x.length, 9) }, (_, i) => i in x ? show(x[i]) : "_").join() + "]#" + x.length : typeof x; } catch (e) { return "!" + e.constructor.name; } }
const rope = n => "oa".repeat(n) + (cases & 1 ? "o" : "b");
const odd = { length: 3, 0: "o", get 1() { calls++; return "o"; }, 2: "x" };
const inputs = [
  () => ["foo", "boo", "", "o", "xyz"], () => ["föo", "你o好", "😀o", "o"], () => [rope(1), rope(2), rope(9), "o"], () => [["o", "a", "o"], ["b"], [], ["o"]], () => ["foo", ["o", "o"], "o", ["x"]], () => [[1, 2, "o"], ["o", , "o"], "oo"], () => ["foo", , "boo"], () => ["foo", null, "boo"], () => ["foo", undefined, "boo"], () => ["foo", 5, "ooo", true], () => [odd, "oo", odd], () => [new String("oo"), "o"], () => [new Uint8Array([111, 1]), "o"], () => [[], "", "ooo"], () => [], () => Object.freeze(["foo", "o"]), () => new Array(3), () => [1, 2, 3], () => [1.5, 2.5], () => "foo", () => ["o".repeat(70), "x".repeat(70)], () => ({ length: 2, 0: "foo", 1: "oo" }), () => new Set(["oo"]), () => null, () => undefined, () => { const a = ["foo", "boo", "oo"]; Object.defineProperty(a, 1, { get() { calls++; return "ogo"; } }); return a; },
];
function count(w) { let n = 0; for (let k = 0; k < w.length; k++) for (let i = 0; i < w[k].length; i++) if (w[k][i] === "o") n++; return n; }
function vowels(w) { let n = 0; for (let k = 0; k < w.length; k++) for (let i = 0; i < w[k].length; i++) if (w[k][i] === "o" || w[k][i] === "a") n += i; return n; }
function table(w) { const at = []; for (let y = 0; y < w.length; y++) for (let x = 0; x < w[y].length; x++) if (w[y][x] !== "o") at.push(y * 10 + x); return at; }
function kinds(w) { let n = 0; for (let k = 0; k < w.length; k++) for (let i = 0; i < w[k].length; i++) switch (w[k][i]) { case "o": n++; break; case "x": n += 2; break; case "b": n += 3; break; default: n += 10; } return n; }
function broken(w) { let n = 0; for (let k = 0; k < w.length; k++) for (let i = 0; i < w[k].length; i++) { if (w[k][i] === "x") break; n++; } return n; }
function found(w) { for (let k = 0; k < w.length; k++) for (let i = 0; i < w[k].length; i++) if (w[k][i] === "b") return k * 100 + i; return -1; }
function replaced(w) { let n = 0; for (let k = 0; k < w.length; k++) for (let i = 0; i < w[k].length && n < 50; i++) { if (w[k][i] === "o") n++; if (i === 1 && Array.isArray(w) && !Object.isFrozen(w)) w[k] = ["o", "o", "o", "x"]; } return n; }
function grown(w) { let n = 0; for (let k = 0; k < w.length; k++) for (let i = 0; i < w[k].length && n < 50; i++) { if (w[k][i] === "o") { n++; if (Array.isArray(w[k]) && w[k].length < 6) w[k].push("o"); } } return n; }
function called(w) { let n = 0; for (let k = 0; k < w.length; k++) for (let i = 0; i < w[k].length; i++) if (w[k][i] === "x") n += show(k).length; else n++; return n; }
function beyond(w) { let n = 0; for (let k = 0; k < w.length; k++) for (let i = 0; i < w[k].length; i++) if (w[k][i + 1] === "o") n += i; return n; }
function down(w) { let n = 0; for (let k = w.length - 1; k >= 0; k--) for (let i = w[k].length - 1; i >= 0; i--) if (w[k][i] === "o") n = n * 3 + i | 0; return n; }
function caught(w) { let n = 0; for (let k = 0; k < w.length; k++) try { for (let i = 0; i < w[k].length; i++) if (w[k][i] === "o") n++; } catch (e) { n += 1000; } return n; }
function neighbors(w) { let n = 0; for (let y = 1; y < w.length; y++) for (let x = 0; x < w[y].length; x++) if (w[y][x] === "o" && w[y - 1][x] === "o") n++; return n; }
function exchanged(w, v) { let n = 0; for (let k = 0; k < w.length; k++) for (let i = 0; i < w[k].length; i++) { if (w[k][i] === "o") n++; if (i === 1) w[k] = v; } return n; }
function shortened(w, v) { let n = 0; for (let k = 0; k < w.length; k++) for (let i = 0; i < w[k].length; i++) { w[k] = v; if (w[k][i] === "o") n += i + 1; } return n; }
function others(w, v) { let n = 0; for (let k = 0; k < w.length; k++) for (let i = 0; i < w[k].length; i++) { if (w[k][i] === "o") n++; w[0] = v; } return n; }
function popped(w) { let n = 0; for (let k = 0; k < w.length; k++) for (let i = 0; i < w[k].length; i++) { if (w[k][i] === "x") { w.length = k + 1; n += 5; } n++; } return n; }
const forms = [count, vowels, table, kinds, broken, found, replaced, grown, called, beyond, down, caught, neighbors, exchanged, shortened, others, popped];
const values = ["xoxo", "oooooo", ["o", "x"], "", [], 5, undefined, "\u4f60o"];
function tried(f, w, v) { calls = 0; let answer; try { answer = show(f(w, v)); } catch (e) { answer = e.constructor.name; } keep(f.name + " " + answer + (Array.isArray(w) ? show(w) : "") + calls); }
for (let round = 0; round < 3; round++) for (const f of forms) for (const w of inputs) for (const v of f.length > 1 ? values : [0]) tried(f, w(), v);
console.log(cases, digest); for (const x of said) console.log(x);
