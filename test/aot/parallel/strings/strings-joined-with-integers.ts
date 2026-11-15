// Strings joined with integers: constants, flat, joined, cut, wide, empty and long strings before and behind, every size of integer, as keys, growing.
const out: string[] = [];
const show = (name: string, f: () => unknown) => { let r: unknown; try { r = f(); } catch (e: any) { r = e.constructor.name + ": " + e.message; } out.push(name + " " + String(r)); };
const integers: number[] = [0, 1, 9, 10, 63, 64, 99, 100, 255, 256, 257, 999, 1000, 1023, 1024, 4095, 4096, 65535, 99999, 100000, 1234567, 99999999, 100000000, 2 ** 30, 2 ** 31 - 1, -1, -9, -10, -64, -255, -256, -1000, -99999, -(2 ** 31), -(2 ** 31) + 1];
const others: number[] = [2 ** 31, -(2 ** 31) - 1, 2 ** 32, 2 ** 53, -0, 0.5, NaN, Infinity, 1e21];
const text = "a longer text of which pieces are cut, é too, and more of it behind that", long48 = "x".repeat(48), long49 = "x".repeat(49);
const heads: string[] = ["", "a", "item", "item-", text.slice(2, 8), text.slice(36, 42), "jo" + text.slice(0, out.length + 3), "Ж", "wide 😀", long48, long49, text, text + text, "0", "-"];
function before(s: string, list: number[]) { const r: string[] = []; for (const i of list) r.push(s + (i | 0)); return r.join(); }
function behind(s: string, list: number[]) { const r: string[] = []; for (const i of list) r.push((i | 0) + s); return r.join(); }
function between(s: string, t: string, list: number[]) { const r: string[] = []; for (const i of list) r.push(s + (i | 0) + t); return r.join(); }
function template(s: string, t: string, list: number[]) { const r: string[] = []; for (const i of list) r.push(`${s}${i | 0}${t}`, `${s}:${i | 0}`, `(${i | 0})`, `${i | 0}${s}`, `${i | 0}%`, `${s}${i | 0}`, `<${i | 0}${t}`, `${s}${i | 0}>`, `${i | 0}${i | 0}`, `${i | 0}-${i | 0}`, `${s}${i | 0}/${i | 0}${t}`, `x${i | 0}y${s}z${i | 0}`); return r.join(); }
function ofNumbers(s: string, list: number[]) { const r: string[] = []; for (const i of list) r.push(s + i, i + s, `${s}${i}${s}`, `n${i}`); return r.join(); }
function constants(n: number) { const r: string[] = []; for (let i = -n; i < n; i++) r.push("item" + i, i + "px", "(" + i + ")", "a" + i + "b" + i + "c", "Ж" + i, i + "Ж", "" + i, i + ""); return r.join(); }
function counted(n: number) { let s = ""; for (let i = 0; i < n; i++) s += i; let t = ""; for (let i = 0; i < n; i++) t += "," + i; let u = "u"; for (let i = 0; i < n; i++) u = u + i + ";"; return s + t + u; }
function keys(n: number) { const m = new Map<string, number>(), o: Record<string, number> = {}; for (let i = 0; i < n; i++) { const k = "k" + (i % 300); m.set(k, (m.get(k) || 0) + 1); o["o" + (i % 70)] = i; o[`p${i % 5}x`] = i; } return m.size + [...m.keys()].slice(290).join() + m.get("k" + 7) + Object.keys(o).length + o.o69 + o["p" + 3 + "x"] + ("o" + 12 in o); }
function kept(n: number) { const a: string[] = []; for (let i = 0; i < n; i++) a.push("v" + i * 1001); if (typeof Bun === "object") Bun.gc(true); return a[0] + a[n - 1] + a[n >> 1] + (a[5] === "v" + 5005) + a.indexOf("v" + 2002) + new Set(a).size; }
function views() { const b = new Uint8Array([0, 200, 255]), w = new Int32Array([-1, 2 ** 31 - 1]), r: string[] = []; for (const v of b) r.push("b" + v, v + "b"); for (const v of w) r.push(`w${v}w`); return r.join(); }
for (const s of heads) { show("before " + s.length, () => before(s, integers)); show("behind", () => behind(s, integers)); show("numbers", () => ofNumbers(s, [...integers, ...others])); for (const t of ["", "t", text.slice(5, 9), "Ж", long49]) { show("between", () => between(s, t, integers)); show("template", () => template(s, t, integers)); } }
show("constants", () => constants(300)); show("counted", () => counted(700)); show("keys", () => keys(2000)); show("kept", () => kept(3000)); show("views", views);
show("once", () => { const i = integers[12] | 0; return "a" + i + `b${i}c` + (i + "d"); });
show("compared", () => ("a" + (integers[5] | 0) === "a64") + String(("x" + (integers[13] | 0)).length) + ("y" + (integers[26] | 0)).charCodeAt(1) + ("z" + (integers[30] | 0)).slice(1) + ("q" + (integers[2] | 0)).split("").join("."));
show("number again", () => [+("" + (integers[20] | 0)), Number("1" + (integers[6] | 0)), parseInt("7" + (integers[7] | 0)), JSON.stringify({ ["k" + (integers[8] | 0)]: "v" + (integers[9] | 0) })].join());
for (const line of out) console.log(line);
