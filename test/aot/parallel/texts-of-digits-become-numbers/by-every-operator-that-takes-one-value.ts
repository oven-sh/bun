// Texts become numbers by `~`, `+`, `-`, `++` and Number(): few digits, many digits, zeros in front, signs, blanks, points, exponents, other radixes, wide digits, the empty text, texts joined of pieces and slices.
const texts: any[] = [
  "0", "7", "42", "117", "2048", "007", "000", "4294967295", "4294967296", "2147483647", "2147483648", "999999999999999", "1000000000000000", "9007199254740993",
  "123456789012345678901234567890", "", " ", " 12", "12 ", "\t5\n", "+5", "-5", "- 5", "1.5", ".5", "5.", "1e3", "1E-2", "0x1f", "0b101", "0o17", "1_000", "12a", "a12", "Infinity", "-Infinity", "NaN",
  "١٢", "１２", "1 ", "12\u0000",
];
const bag: { value: any } = { value: 0 };
const lines: string[] = [];
function all(value: any): string {
  bag.value = value;
  let counted = bag.value;
  counted++;
  return [~bag.value, ~~bag.value, +bag.value, -bag.value, counted, Number(bag.value), bag.value * 1, bag.value | 0].join(",");
}
for (const text of texts) lines.push(JSON.stringify(text) + ":" + all(text));
for (let i = 0; i < 40; i++) {
  const joined = String(i * 37) + String(i % 7);
  const cut = ("x" + i * 1234567 + "y").slice(1, -1);
  lines.push(all(joined) + ";" + all(cut));
}
let sum = 0;
for (const line of lines) for (let i = 0; i < line.length; i++) sum = (sum * 33 + line.charCodeAt(i)) % 1000000007;
console.log(lines.length, sum);
console.log(lines.slice(0, 14).join(" "));
let total = 0;
const lengths: any[] = ["117", "2048", "13", "0"];
for (let i = 0; i < 200000; i++) total += ~~lengths[i & 3] + +lengths[(i + 1) & 3];
console.log(total);
