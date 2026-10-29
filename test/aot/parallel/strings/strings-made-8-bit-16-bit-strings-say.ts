// Makes strings out of strings held in 8 and in 16 bits and prints in how many bits each result is held.
import { jscDescribe } from "bun:jsc";

function widthOf(value: unknown): string {
  if (typeof value !== "string") return typeof value;
  const found = /8Bit:\((\d)\),length:\((\d+)\)/.exec(jscDescribe(value));
  return found ? `${found[1] === "1" ? 8 : 16}/${found[2]}` : "?";
}

function print(name: string, ...values: unknown[]) {
  console.log(name.padEnd(44), values.flat().map(widthOf).join(" "));
}

const letters = "abcdefghijklmnopqrstuvwxyz0123456789ABCD";
const narrow = (text: string): string => Buffer.from(text, "latin1").toString("latin1");
const held = (text: string): string => Buffer.from(text, "utf16le").toString("utf16le");

const operands: Record<string, () => string> = {
  "8 bits": () => narrow(letters),
  "16 bits, all ASCII": () => held(letters),
  "16 bits, all Latin-1": () => held("éàü" + letters),
  "16 bits": () => held("中文" + letters),
  "8 bits beside 16 bits": () => narrow(letters) + held("中文" + letters),
  "16 bits beside 8 bits": () => held("中文" + letters) + narrow(letters),
  "a written character beside 8 bits": () => "中" + narrow(letters),
  "a part of 16 bits": () => held("中文" + letters).slice(2),
  "three units in 16 bits": () => held("abc"),
  "spaces around, in 16 bits": () => held("  abc def  "),
};

const operations: Record<string, (s: string) => unknown> = {
  "itself": (s: string) => s,
  "two units": (s: string) => [s.slice(0, 2), s.slice(2, 4), s.slice(-2), s.substring(1, 3), s.slice(1).slice(0, 2)],
  "one unit": (s: string) => [s[0], s.charAt(2), s.at(-1), s.slice(0, 1)],
  "longer parts": (s: string) => [s.slice(1), s.slice(0, -1), s.slice(3, 9), s.substring(2)],
  "a match of two units": (s: string) => [s.match(/^.{2}/)?.[0], s.match(/(b)(c)/)?.slice(0, 3), s.match(/bc/)?.[0]],
  "behind a written character": (s: string) => [("中" + s).slice(1), ("中" + s).slice(1, 4), `中${s}`.slice(1), (s + "中").slice(0, -1)],
  "between written characters": (s: string) => [("中" + s + "1").slice(1, -1), ("中" + s + "1").slice(-1), ("1" + s + "中").slice(0, 1)],
  "five parts": (s: string) => {
    const joined = s + "-" + s + "-" + s;
    return [joined, joined.slice(0, 3), joined.slice(-3)];
  },
  "a template": (s: string) => [`${s}-${1}-${s}`, `a${s}b${s}c${s}d`, `[${s}]`],
  "added three times": (s: string) => {
    let text = "";
    for (let i = 0; i < 3; i++) text += s;
    return [text, text.slice(0, 3)];
  },
  "added with a separator": (s: string) => {
    let text = "";
    for (let i = 0; i < 3; i++) text += s + ",";
    return text;
  },
  "added in parts of four": (s: string) => {
    const flat = held(s);
    let text = "";
    for (let i = 0; i + 4 <= flat.length; i += 4) text += flat.slice(i, i + 4);
    return text;
  },
  "added unit by unit": (s: string) => {
    let text = "";
    for (let i = 0; i < s.length; i++) text += s[i];
    return text;
  },
  "a written character added last": (s: string) => {
    let text = "";
    for (let i = 0; i < 3; i++) text += s;
    text += "中";
    return [text, text.slice(0, 3)];
  },
  "case": (s: string) => [s.toUpperCase(), s.toLowerCase(), s.toUpperCase().toLowerCase()],
  "trimmed": (s: string) => [s.trim(), s.trimStart(), s.trimEnd(), (" " + s + " ").trim()],
  "decoded and encoded": (s: string) => [decodeURIComponent(s), decodeURI(s), encodeURIComponent(s), encodeURI(s)],
  "replaced": (s: string) => [s.replaceAll("a", "b"), s.replaceAll("bc", ""), s.replaceAll("a", "中"), s.replace("a", "b"), s.replaceAll("zz", "y")],
  "split": (s: string) => [s.split("d"), s.split("bc").slice(0, 2), (s + "," + s).split(",")],
  "the first two of a split": (s: string) => {
    const [first, second] = s.split("d");
    return [first, second];
  },
  "repeated": (s: string) => [s.repeat(1), s.repeat(2), s.repeat(3), s.repeat(2).slice(0, 3)],
  "padded": (s: string) => [s.padStart(60), s.padEnd(60, "ab"), s.padStart(60, "中"), s.padStart(60).slice(0, 3), s.padStart(1100).slice(0, 3)],
  "joined": (s: string) => [[s, s].join(), [s, "a"].join(""), [s, "中"].join(""), ["a", "b"].join(s)],
};

print("quoted", JSON.stringify(narrow(letters)), JSON.stringify(held(letters)), JSON.stringify(held("éàü" + letters)), JSON.stringify(held("中文" + letters)));

for (const [operandName, makeOperand] of Object.entries(operands)) {
  for (const [operationName, operate] of Object.entries(operations)) print(`${operandName}: ${operationName}`, operate(makeOperand()));
}

print("written joins", "中" + "abc", "abc" + "中", `中${1}b`, "é" + "abc", "abc" + "def");
print("parts of written joins", ("中" + "abcdefgh").slice(1), ("abcdefgh" + "中").slice(0, -1), "中abcdefgh".slice(1), "中abcdefgh".slice(1, 3));
const joined = "中" + "abcdefgh";
print("a part of a written join in a constant", joined, joined.slice(1));
print("written calls", "abc".concat("中").slice(0, 3), "a".padEnd(3, "中"), "中bc".replace("中", "a"), "É".toLowerCase(), "ÿ".toUpperCase());
print("formatted numbers", (1234.5).toLocaleString("en"), (1234).toLocaleString("en"), (1234.5).toLocaleString("de"), (1234.5).toLocaleString());
print("formatted lists", new Float64Array([1234.5, 1]).toLocaleString("en"), [1234.5, 1].toLocaleString("en"));

const long = "x".repeat(40);
console.log(Bun.inspect([("中" + long).slice(1), "o"]));
const formatted = (1234.5).toLocaleString("en");
console.log(Bun.inspect([formatted, formatted, formatted, formatted, formatted, formatted, formatted, formatted]));
console.log(Bun.inspect(new Set([held("\x1b[31m" + long), held("\x1b[31m" + long) + "1"])));
