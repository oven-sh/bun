// Numbers become the strings JavaScript prescribes, and the same number gives equal keys.
const integers = [0, 1, 9, 10, 1022, 1023, 1024, 1025, 9999, 10000, 2147483646, 2147483647, 2147483648, 4294967295, 4294967296, 9007199254740991, 9007199254740992, 9007199254740993, -1, -1023, -1024, -1025, -2147483647, -2147483648, -2147483649, -9007199254740992];
const doubles = [-0, 0.1, 1.5, -1.5, 1e20, 1e21, 1.5e21, -1e21, 1e-6, 1e-7, 1.7976931348623157e308, 5e-324, NaN, Infinity, -Infinity, 2 ** 31, 2 ** 53, 2 ** 64];
function forms(number) {
  return [String(number), "" + number, `${number}`, number + "", number.toString()];
}
function sameKey(number) {
  const keys = new Map();
  keys.set(String(number), 1);
  keys.set(`${number}`, 2);
  keys.set(number + "", 3);
  const object = {};
  object[number] = 1;
  object[String(number)] = 2;
  return [keys.size, keys.get("" + number), Object.keys(object).length, object[number], String(number) === `${number}`].join(" ");
}
for (const number of [...integers, ...doubles]) {
  const texts = forms(number);
  console.log(texts.join(" "), new Set(texts).size, sameKey(number));
}
let total = 0;
for (let i = 1000; i < 1050; i++) {
  const key = "" + i;
  if (key === String(i) && key.length === 4) total += key.charCodeAt(3);
}
console.log(total);
for (let i = 0; i < 300; i++) {
  const character = String.fromCharCode(i);
  if (character !== `${character}` || character.charCodeAt(0) !== i) console.log("wrong character", i);
}
console.log("\u{1F600}".length, String.fromCharCode(0xd83d) + String.fromCharCode(0xde00) === "\u{1F600}");
const lookalikes = ["007", "01", "00", "1.0", "1e3", "+1", " 1", "-0", "0x10", "2147483648.0"];
const table = {};
for (const text of lookalikes) table[text] = text;
console.log(Object.keys(table).join(" "));
for (const text of lookalikes) console.log(JSON.stringify(text), Number(text), String(Number(text)), String(Number(text)) === text, table[Number(text)]);
