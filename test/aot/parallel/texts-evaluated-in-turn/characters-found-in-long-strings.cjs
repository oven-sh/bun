// indexOf() of one character by text made at run time, in strings of every length up to some hundred characters and in long ones, from starts of every kind, of one and of two bytes a character.
"use strict";
const hidden = t => [t, "0"][process.argv.length > 90 ? 1 : 0], F = (...a) => new Function(...a.slice(0, -1), hidden(a[a.length - 1]));
const lines = [];
const told = f => { try { return String(f()); } catch (e) { return e.name + ": " + e.message; } };
const index = F("s", "w", "return s.indexOf(w);"), from = F("s", "w", "i", "return s.indexOf(w, i);"), all = F("s", "w", "const places = []; for (let at = s.indexOf(w); at >= 0; at = s.indexOf(w, at + 1)) places.push(at); return places.join();");
const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_.:/ ", whole = alphabet.repeat(3);
for (const prefix of ["", "\u0416"]) for (let length = 0; length <= 150; length += length < 70 ? 1 : 11) {
  const s = JSON.parse(JSON.stringify(prefix + whole.slice(0, length))), r = [];
  for (let i = 0; i < length; i += 1 + (length >> 5)) r.push(index(s, whole[i]), from(s, whole[i], i), from(s, whole[i], i + 1));
  lines.push(`${prefix.length} ${length} ${r.join()} ${index(s, "#")} ${from(s, "#", 3)} ${from(s, "#", length)} ${from(s, "a", length + 1)} ${all(s, "a")} ${index(s, "")} ${index(s, "ab")}`);
}
for (const i of [undefined, null, 0, 1, 31, 32, 33, 34, 66, 67, 68, 1000, 2 ** 31 - 1, 2 ** 31, -1, -(2 ** 31), 1.5, -0, NaN, Infinity, "3", true, { valueOf: () => 40 }, Symbol("i")]) lines.push(`from ${typeof i} ${told(() => String(i))} ${told(() => from(whole, "z", i))} ${told(() => from(whole, "#", i))} ${told(() => from(whole.slice(0, 33), "a", i))}`);
const long = "word and more of it, ".repeat(400) + "#";
for (const w of ["#", "w", "z", ",", "\u00e9", "\u0416"]) lines.push(`long ${w} ${index(long, w)} ${from(long, w, 8000)} ${from(long, w, 8399)} ${from(long, w, 8400)} ${from(long, w, 8401)}`);
lines.push(F("t", "n", "let r = 0; for (let i = 0; i < n; i++) { r = (r * 31 + t.indexOf('#', i) + t.indexOf(';') + t.indexOf('o', i)) | 0; } return r;")(long, 2000));
for (const l of lines) console.log(l);
console.log(lines.length);
