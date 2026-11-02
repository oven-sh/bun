// The public JSONTestSuite (github.com/nst/JSONTestSuite, see README.md): every file goes through `JSON.parse(text) as T` for types that take anything, inside wrappers, and for the types written to fit the files that are valid: the SyntaxError of JSON.parse, or its value.
import files from "./files.json";
import { fits, parsers } from "./fitted";

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
type Point = { x: number; y: number };

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function bytesOf(base64: string): number[] {
  const bytes: number[] = [];
  let bits = 0;
  let count = 0;
  for (let at = 0; at < base64.length && base64[at] !== "="; at++) {
    bits = (bits << 6) | alphabet.indexOf(base64[at]);
    count += 6;
    if (count >= 8) {
      count -= 8;
      bytes.push((bits >> count) & 0xff);
    }
  }
  return bytes;
}
function bytesOfFile(stored: string | { repeat: string; times: number; then: string }): number[] {
  if (typeof stored === "string") return bytesOf(stored);
  const unit = bytesOf(stored.repeat);
  const bytes: number[] = [];
  for (let count = 0; count < stored.times; count++) bytes.push(...unit);
  bytes.push(...bytesOf(stored.then));
  return bytes;
}

function textOf(units: number[]): string {
  let text = "";
  for (let at = 0; at < units.length; at += 4096) text += String.fromCharCode(...units.slice(at, at + 4096));
  return text;
}

// As TextDecoder("utf-8", { ignoreBOM: true }) decodes: U+FFFD for each maximal part of an ill-formed sequence.
function fromUTF8(bytes: number[]): string {
  const units: number[] = [];
  for (let at = 0; at < bytes.length; ) {
    const first = bytes[at++];
    if (first < 0x80) {
      units.push(first);
      continue;
    }
    let needed = first >= 0xc2 && first <= 0xdf ? 1 : first >= 0xe0 && first <= 0xef ? 2 : first >= 0xf0 && first <= 0xf4 ? 3 : 0;
    if (!needed) {
      units.push(0xfffd);
      continue;
    }
    let low = first === 0xe0 ? 0xa0 : first === 0xf0 ? 0x90 : 0x80;
    let high = first === 0xed ? 0x9f : first === 0xf4 ? 0x8f : 0xbf;
    let point = first & (needed === 1 ? 0x1f : needed === 2 ? 0x0f : 0x07);
    for (; needed > 0; needed--) {
      const next = bytes[at];
      if (next === undefined || next < low || next > high) break;
      point = (point << 6) | (next & 0x3f);
      low = 0x80;
      high = 0xbf;
      at++;
    }
    if (needed) units.push(0xfffd);
    else if (point < 0x10000) units.push(point);
    else units.push(0xd800 + ((point - 0x10000) >> 10), 0xdc00 + ((point - 0x10000) & 0x3ff));
  }
  return textOf(units);
}

const plainParse: (text: string) => any = globalThis.JSON.parse;

function show(value: any, depth = 0): string {
  if (depth > 400) return "deep";
  if (Array.isArray(value)) return "[" + value.map(item => show(item, depth + 1)).join(",") + "]";
  if (typeof value === "string") return JSON.stringify(value) + value.length;
  if (typeof value !== "object" || value === null) return Object.is(value, -0) ? "-0" : typeof value + ":" + String(value);
  return "{" + Object.getOwnPropertyNames(value).map(key => JSON.stringify(key) + ":" + show(value[key], depth + 1)).join(",") + "}";
}

function outcome(parse: (text: string) => unknown, text: string): string {
  try {
    return show(parse(text));
  } catch (error: any) {
    return error.name + ": " + error.message;
  }
}

const roads: [string, (text: string) => unknown, (text: string) => string][] = [
  ["a type for all JSON", text => JSON.parse(text) as Json, text => text],
  ["an array of all JSON", text => JSON.parse(text) as Json[], text => "[" + text + "," + text + "]"],
  ["a member of unknown type", text => JSON.parse(text) as { value: unknown }, text => '{"value":' + text + "}"],
  ["a member of type any, spaced", text => JSON.parse(text) as { value: any }, text => ' { "value" : ' + text + " } "],
  ["elements of unknown type", text => JSON.parse(text) as unknown[], text => "[" + text + "]"],
  ["a dictionary of unknown", text => JSON.parse(text) as Record<string, unknown>, text => '{"k":' + text + "}"],
  ["an undeclared key", text => JSON.parse(text) as Point, text => '{"x":1,"other":' + text + ',"y":2}'],
  ["a tuple", text => JSON.parse(text) as [number, unknown, string], text => "[1," + text + ',"s"]'],
];

const names = Object.keys(files);
const texts = new Map<string, string[]>();
for (const name of names) {
  const bytes = bytesOfFile((files as Record<string, string | { repeat: string; times: number; then: string }>)[name]);
  texts.set(name, [fromUTF8(bytes), textOf(bytes)]);
}

let shown = 0;
function compare(label: string, name: string, parse: (text: string) => unknown, text: string, counts: number[]): void {
  const typed = outcome(parse, text);
  const plain = outcome(plainParse, text);
  if (typed !== plain) {
    counts[2]++;
    if (shown++ < 20) console.log("DIFFERENT: " + label + ", " + name + "\n  typed: " + typed.slice(0, 200) + "\n  plain: " + plain.slice(0, 200));
  } else counts[plain.startsWith("SyntaxError") ? 1 : 0]++;
}
const told = (counts: number[]) => counts[0] + " values, " + counts[1] + " no JSON: " + counts[2] + " differ";

for (const [label, parse, wrap] of roads) {
  const counts = [0, 0, 0];
  for (const name of names) for (const text of texts.get(name)!) compare(label, name, parse, wrap(text), counts);
  console.log(label + ": " + told(counts));
}
{
  const counts = [0, 0, 0];
  for (const name in fits) compare("the type that fits", name, parsers[fits[name]], texts.get(name)![0], counts);
  console.log("each valid file by the type that fits it: " + told(counts));
}
{
  const counts = [0, 0, 0];
  parsers.forEach((parse, at) => {
    for (const name of names) for (const text of texts.get(name)!) compare("fitted type " + at, name, parse, text, counts);
  });
  console.log("every file by each of the " + parsers.length + " fitted types: " + told(counts));
}
