// JSON.stringify of a value that is proven to be a string: the run time quotes it itself. Texts of every length round the widths that it copies by, with nothing to escape and with one thing to escape at each place,
// narrow and wide, with halves of pairs, as ropes and as pieces of longer strings. Each answer is held against a quoting that is written out here.
function quotedByHand(text) {
  let out = '"';
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (unit === 34) out += '\\"';
    else if (unit === 92) out += "\\\\";
    else if (unit === 8) out += "\\b";
    else if (unit === 9) out += "\\t";
    else if (unit === 10) out += "\\n";
    else if (unit === 12) out += "\\f";
    else if (unit === 13) out += "\\r";
    else if (unit < 32) out += "\\u00" + (unit < 16 ? "0" : "") + unit.toString(16);
    else if (unit >= 0xd800 && unit <= 0xdbff && i + 1 < text.length && text.charCodeAt(i + 1) >= 0xdc00 && text.charCodeAt(i + 1) <= 0xdfff) out += text[i] + text[++i];
    else if (unit >= 0xd800 && unit <= 0xdfff) out += "\\u" + unit.toString(16);
    else out += text[i];
  }
  return out + '"';
}
let texts = 0, wrong = 0, sum = 0;
function check(text) {
  if (typeof text !== "string") return;
  const quoted = JSON.stringify(text);
  texts++;
  if (quoted !== quotedByHand(text)) {
    if (wrong++ < 5) console.log("wrong", text.length, quoted.length, quoted.slice(0, 60));
  }
  for (let i = 0; i < quoted.length; i += 1 + (quoted.length >> 6)) sum = (sum * 31 + quoted.charCodeAt(i)) | 0;
  if (JSON.parse(quoted) !== text) console.log("does not come back", text.length);
}
const plain = "The quick brown fox jumps over the lazy dog, 0123456789 times; éüÿ\u007f~ and so on. ";
const odd = ['"', "\\", "\n", "\t", "\b", "\f", "\r", "\u0000", "\u001f", "\u0001", " ", "\u007f", "\u0080", "ÿ"];
for (let length = 0; length <= 70; length++) {
  const text = plain.repeat(2).slice(0, length) + "";
  check(text);
  for (let at = 0; at < length; at += length < 36 ? 1 : 5) for (const unit of odd) check(text.slice(0, at) + unit + text.slice(at + 1));
}
for (const length of [127, 128, 129, 1000, 4095, 16383, 16384, 16385, 70000, 300000]) {
  const text = plain.repeat(1 + Math.ceil(length / plain.length)).slice(0, length);
  check(text);
  for (const at of [0, 1, 63, 64, length >> 1, length - 17, length - 1]) for (const unit of ['"', "\u0003", "\\"]) check(text.slice(0, at) + unit + text.slice(at + 1));
  check(text + text);
  check(text.slice(3, length - 2));
}
const wide = "Ж中 😀 text    ";
for (let length = 0; length <= 40; length++) {
  const text = wide.repeat(4).slice(0, length);
  check(text);
  for (const unit of ['"', "\\", "\n", "\u0000", "\ud800", "\udc00", "\udfff", "\udbff"]) for (let at = 0; at <= length; at += 3) check(text.slice(0, at) + unit + text.slice(at));
}
for (const length of [1000, 16383, 16384, 16385, 100000]) {
  const text = wide.repeat(1 + Math.ceil(length / wide.length)).slice(0, length);
  check(text);
  check(text.slice(0, length >> 1) + "\ud800" + text.slice(length >> 1));
  check("\udc00" + text + '"');
}
// Wide in memory, narrow by its characters.
const narrowKeptWide = (wide + plain.repeat(3)).slice(wide.length);
check(narrowKeptWide);
check(narrowKeptWide + '"\n');
console.log(texts, wrong, sum);
console.log(JSON.stringify(""), JSON.stringify("a"), JSON.stringify('"'), JSON.stringify(" "), JSON.stringify("\ud800") === '"\\ud800"');
