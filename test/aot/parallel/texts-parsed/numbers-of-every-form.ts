const texts = ["0", "-0", "1", "-1", "9", "10", "42", "100", "1234", "12345", "123456", "1234567", "12345678", "123456789", "1234567890", "2147483647", "2147483648", "-2147483648", "-2147483649", "4294967296", "9007199254740991", "9007199254740992", "9007199254740993", "-9007199254740993", "999999999999999999", "9999999999999999999", "12345678901234567890", "18446744073709551615", "18446744073709551616", "123456789012345678901234567890", "0.1", "0.5", "-1.5", "1.0", "3.0", "-0.0", "0.0", "100.000", "27.140685268008383", "21.999999999999996", "1524012345678.123", "0.30000000000000004", "8.41", "0.000001", "0.0000001", "0.12345678", "0.123456789", "0.1234567890123456", "0.12345678901234567", "0.123456789012345678", "0.1234567890123456789", "1234567890.123456789", "1234567890.1234567890", "9007199254740992.5", "9007199254740993.5", "4503599627370496.5", "4503599627370497.5", "72057594037927944.5", "1844674407370955161.5", "1844674407370955161.6", "1.00000000000000011102230246251565", "1.00000000000000011102230246251564", "1e3", "1E3", "1e+3", "1e-3", "1.5e300", "1e308", "1e309", "-1e309", "1.7976931348623157e308", "5e-324", "2.2250738585072014e-308", "1e-400", "0e0", "123.456e2"];
let wrong = 0;
for (const text of texts) {
  for (const around of [(t: string) => t, (t: string) => `[${t}]`, (t: string) => `{"number":${t}}`, (t: string) => `[0, ${t} ,1]`, (t: string) => `{"a":1,"number":${t},"b":2}`]) {
    const parsed = JSON.parse(around(text));
    const number = Array.isArray(parsed) ? parsed[parsed.length >> 1] : typeof parsed === "object" ? parsed.number : parsed;
    if (!Object.is(number, +text)) console.log("wrong", around(text), number, +text, ++wrong);
  }
}
console.log(texts.length, wrong);
// Random doubles in the form that JavaScript writes them, and with digits cut off.
let state = 99;
const random = (): number => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296;
for (let i = 0; i < 4000; i++) {
  const number = random() * 10 ** Math.floor(random() * 12 - 2) + random() * 1e-9;
  const text = String(number);
  if (text.includes("e")) continue;
  for (let end = text.length; end > text.indexOf(".") + 1; end -= 1 + (i & 3)) {
    const part = text.slice(0, end);
    if (JSON.parse(`[${part}]`)[0] !== +part || JSON.parse(`{"x":-${part}}`).x !== -part) console.log("wrong", part, ++wrong);
  }
}
for (const text of ["01", "00", "-", "-a", "+1", "1.", "1.e1", ".5", "1e", "1e+", "--1", "0x1", "1 2", "1.2.3", "1,", "12345678a", "1234567.", "0.12345678x"]) {
  for (const each of [text, `[${text}]`, `{"a":${text}}`]) {
    try {
      console.log("parsed", each, JSON.stringify(JSON.parse(each)));
    } catch {
      continue;
    }
  }
}
console.log(wrong);
