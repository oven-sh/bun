// parseInt and Number of strings of few digits: every length, every place of a character that is no digit, signs, spaces, ropes, pieces and wide strings.
const others = ["/", ":", " ", "-", "+", ".", "e", "x", "a", "\u0000", "\t", " ", "ÿ", "Ā", " ", "﻿", "１", "\ud800", "٠"];
const digits = "9876543210123456789";
const subjects: string[] = ["", "0", "00", "-0", "+0", "0x10", "0X1f", " 12", "12 ", "\n7", "1e3", "Infinity", "-Infinity", "NaN", "2147483647", "2147483648", "-2147483648", "4294967295", "4294967296", "9007199254740991", "9007199254740992", "9007199254740993", "999999999999999", "000000000000001", "0000000000000001", "99999999", "100000000", "123456789012345678901234567890"];
for (let length = 1; length <= 18; length++) {
  const whole = digits.slice(0, length);
  subjects.push(whole);
  for (let place = 0; place < length; place++)
    for (const other of others) subjects.push(whole.slice(0, place) + other + whole.slice(place + 1));
}
const source = subjects.join("|");
const pieces = source.split("|");
let digest = 0;
const add = (value: number) => {
  const text = Object.is(value, -0) ? "-0" : String(value);
  for (let i = 0; i < text.length; i++) digest = (Math.imul(digest, 31) + text.charCodeAt(i)) | 0;
};
function read(list: string[]): void {
  for (const text of list) {
    add(parseInt(text));
    add(parseInt(text, 10));
    add(parseInt(text, 0));
    add(parseInt(text, 16));
    add(parseInt(text, 36));
    add(parseInt(text, 1));
    add(Number(text));
    add(+text);
    add(parseFloat(text));
  }
}
function readJoined(list: string[]): void {
  for (let i = 1; i < list.length; i++) {
    add(parseInt(list[i - 1] + list[i], 10));
    add(Number(list[i - 1] + list[i]));
  }
}
function readPieces(text: string): void {
  let start = 0;
  for (;;) {
    const end = text.indexOf("|", start);
    if (end < 0) break;
    const piece = text.slice(start, end);
    add(parseInt(piece, 10));
    add(Number(piece));
    add(+text.substring(start, end));
    add(parseInt(text.substring(start, end)));
    start = end + 1;
  }
}
function once(text: string, radix: any): number {
  return parseInt(text, radix) + Number(text);
}
for (let turn = 0; turn < 3; turn++) {
  read(subjects);
  read(pieces);
  readJoined(subjects.slice(0, 60));
  readPieces(source);
  console.log(turn, digest);
}
for (const text of subjects.slice(0, 28)) console.log(JSON.stringify(text), parseInt(text), Object.is(parseInt(text), -0), Number(text), once(text, 10), once(text, undefined), once(text, "16"), once(text, null), once(text, 37));
console.log(parseInt("12" as any, { valueOf: () => 8 } as any), parseInt(undefined as any), parseInt(null as any, 36), parseInt([4] as any));
try { parseInt(Symbol() as any); } catch (error: any) { console.log(error.name); }
