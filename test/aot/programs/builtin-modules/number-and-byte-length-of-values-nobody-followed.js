// Number(value) and Buffer.byteLength(value, encoding) of values that nobody could follow: whatever comes out of JSON text, a dictionary or a call through an unknown function.
const texts = ["", " ", "0", "7", "42", "007", "123456789012345", "1234567890123456", "12345678901234567890", "-5", "+5", "1.5", ".5", "5.", "1e3", "1E-2", "0x1f", "0b101", "0o17", "0X1F", " 12 ", "\t\n12\r\n", "12px", "Infinity", "-Infinity", "infinity", "NaN", "1_000", "١٢", " 12﻿", "1,5", "--1", "0.1e1", "9007199254740993", "1e400", "-0", "12", "1".repeat(400)];
const others = [undefined, null, true, false, 0, -0, 1.5, NaN, Infinity, 10n, -(2n ** 70n), 2n ** 1100n, [], [5], [1, 2], {}, { valueOf() { return 8; } }, { valueOf() { return "9"; } }, { valueOf() { return 3n; } }, { toString() { return "11"; } }, { [Symbol.toPrimitive](hint) { return hint === "number" ? 12 : 13; } }, new Number(14), new String("15"), new Date(16), Object(17n), function () {}];
const throwing = [Symbol("s"), Object(Symbol.iterator), { valueOf() { throw new RangeError("from valueOf"); } }, { [Symbol.toPrimitive]() { return {}; } }, Object.create(null)];
const box = JSON.parse(JSON.stringify({ list: texts }));
function numberOf(table, key) { return Number(table[key]); }
function lengthOf(table, key, encoding) { return Buffer.byteLength(table[key], encoding); }
function lengthAlone(table, key) { return Buffer.byteLength(table[key]); }
const show = value => (Object.is(value, -0) ? "-0" : String(value));
let lines = [];
for (let round = 0; round < 30; round++) {
  lines = [];
  lines.push(box.list.map((_, i) => show(numberOf(box.list, i))).join());
  lines.push(others.map((_, i) => show(numberOf(others, i))).join());
  lines.push(throwing.map((_, i) => { try { return show(numberOf(throwing, i)); } catch (error) { return error.name + " " + error.message.slice(0, 24); } }).join());
  lines.push(box.list.map((_, i) => lengthAlone(box.list, i)).join());
  for (const encoding of [undefined, null, 5, {}, "utf8", "latin1", "hex", "base64", "ucs2", "nonsense"]) lines.push(String(encoding) + ": " + box.list.map((_, i) => lengthOf(box.list, i, encoding)).join());
  const bytes = [new Uint8Array(3), Buffer.from("four"), new ArrayBuffer(5), new DataView(new ArrayBuffer(6)), new Float64Array(2), new SharedArrayBuffer(7)];
  lines.push(bytes.map((_, i) => lengthAlone(bytes, i) + "|" + lengthOf(bytes, i, "hex")).join());
  lines.push([...others.slice(0, 8), ...throwing.slice(0, 2)].map((_, i, list) => { try { return lengthAlone(list, i); } catch (error) { return error.code; } }).join());
}
console.log(lines.join("\n"));
const rope = { text: "12" + box.list[3] + String(box.list.length) };
console.log(numberOf(rope, "text"), lengthAlone(rope, "text"), numberOf({ text: ("€" + box.list[4]).slice(1) }, "text"), lengthAlone({ text: "😀\ud800" + box.list[4] }, "text"));
console.log(Number(), Number(...[]), Number(...["6", "7"]), Number.call({}, box.list[4]), Reflect.apply(Number, null, [box.list[5]]), Buffer.byteLength.call(null, box.list[4]), Reflect.apply(Buffer.byteLength, 5, [box.list[6], "hex"]));
