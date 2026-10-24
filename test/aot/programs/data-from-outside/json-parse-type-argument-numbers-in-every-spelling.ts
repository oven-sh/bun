// Numbers in every spelling, valid and not, in every place where a type expects a number: JSON.parse<T> gives the number JSON.parse gives, bit for bit, or its error.
import type { Schema } from "bun";
const plainParse: (text: string) => any = JSON.parse;

function show(value: any): string {
  if (Array.isArray(value)) return "[" + value.map(show).join(",") + "]";
  if (typeof value === "string") return JSON.stringify(value) + value.length;
  if (typeof value !== "object" || value === null) return Object.is(value, -0) ? "-0" : typeof value + ":" + String(value);
  return "{" + Object.getOwnPropertyNames(value).map(key => JSON.stringify(key) + ":" + show(value[key])).join(",") + "}" + (Object.getPrototypeOf(value) === Object.prototype ? "" : "!");
}

function outcome(parse: (text: string) => unknown, text: string): string {
  try {
    return show(parse(text));
  } catch (error: any) {
    return error.name === "TypeError" && error.issues?.length > 0 ? "refused" : error.name + ": " + error.message;
  }
}

let shown = 0;
function differs(parse: (text: string) => unknown, text: string): number {
  const typed = outcome(parse, text);
  const plain = outcome(plainParse, text);
  if (typed === plain || (typed === "refused" && !plain.startsWith("SyntaxError"))) return 0;
  if (shown++ < 12) console.log("DIFFERENT on " + JSON.stringify(text).slice(0, 300) + "\n  typed: " + typed.slice(0, 300) + "\n  plain: " + plain.slice(0, 300));
  return 1;
}

type Held = { n: number };
type Whole = { n: number & Schema.Int };
type Either = { n: number | string | null };
type Bounded = { n: number & Schema.Min<-1e308> & Schema.Max<1e308> };

const roads: [string, (text: string) => unknown, (number: string) => string][] = [
  ["a member", text => JSON.parse<Held>(text), number => '{"n":' + number + "}"],
  ["a member, spaced", text => JSON.parse<Held>(text), number => '{ "n" : ' + number + " }"],
  ["a member behind an undeclared key", text => JSON.parse<Held>(text), number => '{"u":' + number + ',"n":' + number + ',"v":[' + number + "]}"],
  ["an integer", text => JSON.parse<Whole>(text), number => '{"n":' + number + "}"],
  ["a union", text => JSON.parse<Either>(text), number => '{"n":' + number + "}"],
  ["with bounds", text => JSON.parse<Bounded>(text), number => '{"n":' + number + "}"],
  ["the root", text => JSON.parse<number>(text), number => number],
  ["the root, spaced", text => JSON.parse<number>(text), number => " " + number + "\n"],
  ["elements", text => JSON.parse<number[]>(text), number => "[" + number + "," + number + "]"],
  ["integer elements", text => JSON.parse<(number & Schema.Int)[]>(text), number => "[" + number + "," + number + "]"],
  ["a tuple", text => JSON.parse<[number, number]>(text), number => "[" + number + " , " + number + "]"],
  ["a dictionary", text => JSON.parse<Record<string, number>>(text), number => '{"a":' + number + ',"b":' + number + "}"],
  ["16-bit text", text => JSON.parse<Held>(text), number => ('{"n":' + number + "}Ā").slice(0, -1)],
];

const spellings = [
  "0", "-0", "0.0", "-0.0", "-0e0", "0e0", "0E+0", "0e400", "-0e400", "0e-400", "0.0e-0", "1", "-1", "1.0", "1.5", "-1.5", "1.50", "100", "1e2", "1E2", "1e+2", "1E+2", "1e02", "10e1", "1000e-1", "15e-1", "0.1", "0.2", "0.30000000000000004",
  "1e400", "-1e400", "1E400", "1e-400", "1E-400", "-1e-400", "5e-324", "4.9e-324", "3e-324", "2.4703282292062327e-324", "2.4703282292062328e-324", "2.5e-324", "2.2250738585072014e-308", "2.2250738585072011e-308", "2.225073858507201e-308",
  "1.7976931348623157e308", "1.7976931348623158e308", "1.7976931348623159e308", "1.797693134862315807e308", "1.797693134862315808e308", "17976931348623157e292", "1.8e308", "-1.7976931348623159e308",
  "9007199254740991", "9007199254740992", "9007199254740993", "9007199254740994", "9007199254740995", "-9007199254740991", "-9007199254740992", "-9007199254740993", "9007199254740993.0", "9007199254740992.5", "900719925474099.3e1",
  "2147483647", "2147483648", "-2147483648", "-2147483649", "4294967295", "4294967296", "999999999", "1000000000", "9999999999", "-999999999", "-1000000000",
  "9223372036854775807", "9223372036854775808", "-9223372036854775808", "-9223372036854775809", "18446744073709551615", "18446744073709551616", "18446744073709551617", "36893488147419103232",
  "123456789012345", "1234567890123456", "12345678901234567", "123456789012345678", "1234567890123456789", "12345678901234567890", "123456789012345678901234567890", "1234567890123456789012345678901234567890",
  "0.123456789012345", "0.1234567890123456", "0.12345678901234567", "0.123456789012345678", "0.1234567890123456789012345678901234567890", "123456.789012345678901234567890e-10",
  "1e21", "1e22", "1e23", "1e-22", "1e-23", "9.5e22", "8.5e23", "123456789012345e22", "123456789012345e23", "123456789012345e-22", "123456789012345e-23", "999999999999999e22", "1e15", "1e16", "1e-5", "1e-6", "1e-7",
  "1.00000000000000011102230246251565404236316680908203125", "1.00000000000000011102230246251565404236316680908203124", "1.00000000000000011102230246251565404236316680908203126",
  "1e1000000000", "1e-1000000000", "1e2147483647", "1e2147483648", "1e-2147483648", "1e-2147483649", "1e4294967296", "1e4294967297", "1e99999999999999999999", "1e-99999999999999999999", "0e99999999999999999999", "0.0e-99999999999999999999", "-0e99999999999999999999",
  "1" + "0".repeat(308), "1" + "0".repeat(309), "1" + "0".repeat(400), "0." + "0".repeat(322) + "1", "0." + "0".repeat(323) + "1", "0." + "0".repeat(323) + "3", "0." + "0".repeat(400) + "1", "1." + "9".repeat(400), "1." + "0".repeat(400) + "1",
  "1" + "0".repeat(400) + "e-400", "0." + "0".repeat(400) + "1e401", "9".repeat(15), "9".repeat(16), "9".repeat(17), "9".repeat(18), "9".repeat(19), "9".repeat(20), "9".repeat(21), "9".repeat(5000), "0." + "9".repeat(5000), "1e" + "0".repeat(5000) + "1",
  "01", "00", "-01", "-00", "007", "+1", "+0", "1.", "-1.", "0.", ".5", "-.5", "-", "--1", "-+1", "1e", "1E", "1e+", "1e-", "1e+-1", "1.e1", "1.5e", "1.5e+", "1..5", "1.5.5", "1e5.5", "1e5e5", "0x10", "0b1", "0o7", "1_000", "1n", "1f", "1d",
  "Infinity", "-Infinity", "NaN", "-NaN", "infinity", "nan", "1 2", "1,", ",1", "- 1", "1 .5", "1. 5", "1 e5", "1e 5", "¹", "١", "１", "1\u0000", "\u00001", "1 ", " 1", "﻿1", "1﻿", "", " ", "-e1", "e1", "E1", ".", ".e1", "0e", "0e+", "0.e1", "-0.", "-0e",
];

for (const [label, parse, wrap] of roads) {
  let different = 0;
  for (const spelling of spellings) different += differs(parse, wrap(spelling));
  console.log(label + ": " + spellings.length + " spellings: " + different + " differ");
}

let seed = 12345;
function random(limit: number): number {
  seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
  return (seed >>> 8) % limit;
}
function digits(count: number): string {
  let text = "";
  for (let at = 0; at < count; at++) text += String(random(10));
  return text;
}
for (const [label, parse, wrap] of roads) {
  let different = 0;
  for (let round = 0; round < 4000; round++) {
    let spelling = random(2) ? "-" : "";
    spelling += random(4) ? String(1 + random(9)) + digits(random(round % 5 ? 8 : 24)) : "0";
    if (random(2)) spelling += "." + digits(1 + random(round % 3 ? 6 : 24));
    if (random(2)) spelling += (random(2) ? "e" : "E") + ["", "+", "-"][random(3)] + String(random(round % 7 ? 30 : 340));
    different += differs(parse, wrap(spelling));
  }
  console.log(label + ": 4000 numbers by chance: " + different + " differ");
}
