// Evaluated text is interpreted in an executable: single characters of strings by index, charAt() and String.fromCharCode(), of whole strings, pieces and ropes with characters of one byte and of two.
const strings = ["", "a", "hello", "é", "ÿĀ", "日本語", "a😀b", "x".repeat(300), "piece of a text".slice(3, 9), JSON.parse('"parsed"'), String(12345), "0123456789abcdef", "\0\x7f\x80\xff", new String("boxed")];
strings.push("ro" + strings[2] + "pe" + strings[4]);
const text = `(function (strings) {
  const lines = [], show = x => typeof x === "string" ? JSON.stringify(x).replace(/[^ -~]/g, c => c.charCodeAt(0).toString(16)) : typeof x + String(x);
  const attempt = f => { try { return show(f()); } catch (error) { return error.name; } };
  const indices = [0, 1, 2, 3, 5, 299, 300, -1, -0, 0.5, 2147483647, 2147483648, 4294967295, NaN, Infinity, "0", "1", "length", "x", undefined, null, true, {}, 1n, Symbol.iterator];
  const made = s => { let t = ""; for (const c of s) t += c; return t; };
  for (let turn = 0; turn < 3; turn++) {
    for (const s of strings) for (const string of [s, made(s), s + "!", ("<" + s + ">").slice(1, -1)]) {
      lines.push(indices.map(i => attempt(() => string[i])).join(), indices.map(i => attempt(() => string.charAt(i))).join(), indices.map(i => attempt(() => String.prototype.charAt.call(string, i))).join());
      let back = ""; for (let i = 0; i < string.length; i++) back += string[i] === string.charAt(i) ? string[i] : "?"; lines.push(show(back === String(string)));
    }
    lines.push(indices.map(i => attempt(() => String.fromCharCode(i))).join(), [0, 65, 127, 128, 255, 256, 65535, 65536, -1, 1.9, "65", [66]].map(i => attempt(() => String.fromCharCode(i))).join(), attempt(() => String.fromCharCode()), attempt(() => String.fromCharCode(72, 105)));
    lines.push([5, true, null, undefined, {}, [1, 2], Symbol("s")].map(x => attempt(() => String.prototype.charAt.call(x, 0)) + attempt(() => x[0])).join());
  }
  let words = "", last = ""; for (const c of "the quick brown fox") if (c === " ") { words += last + ","; last = ""; } else last += c;
  return lines.join("\\n") + words;
})`;
console.log((0, eval)(text)(strings));
console.log(strings.map(s => [s[0], s.charAt(1), String.fromCharCode(s.length)].join()).join(" "));
