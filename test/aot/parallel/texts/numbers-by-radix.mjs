// STATISTIC: BytesAppendedInHexadecimal >= 6
// STATISTIC: NumbersExpectedByRadix >= 4
// Numbers made text by a radix: appended, padded, kept, read while the text grows, behind a handler, in callbacks; bytes, other integers, doubles and what is no number.
const hex = list => { let text = ""; for (let i = 0; i < list.length; i++) text += list[i].toString(16); return text; };
const padded = list => { let text = ""; for (let i = 0; i < list.length; i++) text += list[i].toString(16).padStart(2, "0"); return text; };
const each = list => { let text = "#"; for (const value of list) text += value.toString(16).padStart(2, "0") + ":"; return text; };
const masked = list => { let text = ""; for (let i = 0; i < list.length; i++) text += (list[i] & 255).toString(16).padStart(2, "0") + (list[i] >>> 4).toString(16); return text; };
const read = list => { let text = "", sum = 0; for (let i = 0; i < list.length; i++) { text += list[i].toString(16); sum = (sum * 31 + text.charCodeAt(text.length - 1) + text.length) | 0; } return sum + text; };
const handled = list => { let text = ""; for (let i = 0; i < list.length; i++) try { text += list[i].toString(16).padStart(2, "0"); if (i % 4 === 3) throw text.length; } catch (error) { text += error; } return text; };
const kept = list => { const all = []; let text = ""; for (let i = 0; i < list.length; i++) { const made = list[i].toString(16); text += made; all.push(made, made.length, made === "ff"); } return all.join() + text; };
const other = list => { let text = ""; for (let i = 0; i < list.length; i++) text += list[i].toString(16).padStart(3, "0") + list[i].toString(16).padStart(2, " ") + list[i].toString(16).padEnd(2, "0"); return text; };
const radixes = list => { let text = ""; for (const value of list) text += value.toString(2) + "," + value.toString(8) + "," + value.toString(36) + "," + value.toString(7) + "," + value.toString(10) + ";"; return text; };
const mapped = list => Array.from(list, value => value.toString(16).padStart(2, "0")).join("");
const long = list => { let text = ""; for (let round = 0; round < 40; round++) for (let i = 0; i < list.length; i++) text += list[i].toString(16); return text.length + text.slice(-20); };
const bytes = Uint8Array.from({ length: 40 }, (_, i) => i * 37);
const integers = [0, 9, 10, 15, 16, 159, 160, 255, 256, 4095, 65535, 16777215, 2147483647, -1, -15, -16, -255, -2147483648];
const doubles = [0.5, -0.5, 255.5, -0, NaN, Infinity, -Infinity, 4294967295, 4294967296, 9007199254740991, 1e21, 1e-7];
const others = ["12", true, 255n, { toString: radix => "o" + radix }, new Number(200), [1, 2], new Uint8Array([1, 255])];
for (let pass = 0; pass < 3; pass++) for (const work of [hex, padded, each, masked, read, handled, kept, other, radixes, mapped, long]) {
  for (const list of [bytes, integers, [...integers, ...doubles], doubles, others, [...bytes, "x"]]) {
    try { console.log(work.name, work(list)); } catch (error) { console.log(work.name, error.name); }
  }
}
for (const radix of [1, 37, 16.9, "16", undefined, NaN]) {
  try { let text = ""; for (const value of integers) text += value.toString(radix); console.log(text); } catch (error) { console.log(error.name); }
}
