"use strict";
// STATISTIC: IntegersParsedInBuilders >= 4
// A string that grows in a loop is parsed for an integer: short and long, empty, wide, with each radix, behind a handler and by another parseInt.
function sum(text) { let n = 0, token = ""; for (let i = 0; i < text.length; i++) { const c = text[i]; if (c === " ") { n = (n * 31 + parseInt(token, 10)) | 0; token = ""; } else token += c; } return n + token; }
function each(text) { const list = []; let token = ""; for (let i = 0; i < text.length; i++) { if (text[i] === " ") { list.push(parseInt(token), parseInt(token, 16), parseInt(token, 2), parseInt(token, 36), parseInt(token, 0)); token = ""; } else token += text[i]; } return list; }
function growing(text) { let n = 0, token = ""; for (let i = 0; i < text.length; i++) { token += text[i]; const v = parseInt(token, 10); if (v > 100000) { n += v; token = ""; } if (token.length > 150) token = "-"; } return n + ":" + token.length; }
function handled(text) { let n = 0, token = ""; for (let i = 0; i < text.length; i++) { const c = text[i]; if (c !== " ") { token += c; continue; } try { n += parseInt(token, 10); if (i % 7 === 6) throw new Error("x"); } catch (error) { n += parseInt(token, 8); } token = ""; } return n; }
function other(text, parseInt) { let n = 0, token = ""; for (let i = 0; i < text.length; i++) { if (text[i] === " ") { n += parseInt(token, 10); token = ""; } else token += text[i]; } return n; }
function given(text, radix) { const list = []; let token = ""; for (let i = 0; i < text.length; i++) { if (text[i] === " ") { list.push(parseInt(token, radix)); token = ""; } else token += text[i]; } return list; }
const words = ["0", "12", "-7", "+5", "\t9", "3.75", "1e3", "0x1F", "0X", "ff", "zz", "-0", "007", "2147483648", "9007199254740993", "123456789012345678901234567890", "1".repeat(140), "", "-", "5px", "a5", "\xa07", "中1", "1_000", "-0x10", "Infinity"];
const texts = [words.join(" ") + " ", words.join(""), "", " ", "1 2 3 4 5 6 7 8 9 10 ", words.map(word => word + " ").join("").repeat(3)];
const show = value => Array.isArray(value) ? value.map(show).join() : Object.is(value, -0) ? "-0" : String(value);
for (let pass = 0; pass < 2; pass++) for (const text of texts) {
  const said = [sum(text), each(text), growing(text), handled(text), other(text, (string, radix) => string.length * radix)];
  for (const radix of [10, 16, undefined, 2, "8", 10.9, NaN, 1, 37]) said.push(given(text, radix));
  console.log(said.map(show).join(" | "));
}
