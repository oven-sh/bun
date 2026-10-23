// "The result is one of these string literals" is a fact about text, not about cells. The same text arrives as a rope, a substring, a 16-bit string, out of JSON, out of a number, out of a buffer: every comparison, switch, key and member test must answer as for the literal.
function kindOf(n: number): string {
  if (n < 0) return "negative";
  if (n === 0) return "zero";
  return n % 2 ? "odd" : "even";
}
function colorOf(n: number): "red" | "green" | "blue" {
  return n % 3 === 0 ? "red" : n % 3 === 1 ? "green" : "blue";
}
function isRed(color: string): boolean {
  return color === "red";
}
function rank(color: string): number {
  switch (color) {
    case "red":
      return 1;
    case "green":
      return 2;
    case "blue":
      return 3;
    case "":
      return 0;
    default:
      return -1;
  }
}
function normalize(color: string): string {
  return color === "crimson" ? "red" : color;
}
function sameText(a: string, b: string): boolean {
  return a === b;
}
function join(a: string, b: string): string {
  return a + b;
}
const table: Record<string, number> = { red: 10, green: 20, blue: 30 };
function lookUp(color: string): number | undefined {
  return table[color];
}
const known = new Set(["red", "green", "blue"]);
const prices = new Map([
  ["red", 1],
  ["green", 2],
]);
let warm = 0;
for (let i = 0; i < 3000; i++) {
  const color = colorOf(i);
  warm += rank(color) + (isRed(color) ? 1 : 0) + (sameText(color, "red") ? 1 : 0) + lookUp(color)! + kindOf(i - 5).length + normalize(color).length + (known.has(color) ? 1 : 0);
}
console.log(warm);

// Every way to the text "red" that is not the literal.
const r = String.fromCharCode(114);
const wide = "red\u{1F600}".slice(0, 3);
const ways: [string, string][] = [
  ["a rope", join("r", "ed")],
  ["a rope of ropes", join(join(r, "e"), join("", "d"))],
  ["a long rope cut", join("xxxxxxxxxxxxxxxxxxxxred", "yyyyyyyyyyyyyyyyyyyy").slice(20, 23)],
  ["a substring", "credit".substring(1, 4)],
  ["out of 16 bits", wide],
  ["out of JSON", JSON.parse('{"color":"red"}').color],
  ["a key out of JSON", Object.keys(JSON.parse('{"red":1}'))[0]],
  ["by code units", String.fromCharCode(114, 101, 100)],
  ["an array joined", ["r", "e", "d"].join("")],
  ["replaced", "rod".replace("o", "e")],
  ["lower case", "RED".toLowerCase()],
  ["trimmed", "  red ".trim()],
  ["a template", `${r}ed`],
  ["repeated and cut", "redred".slice(3)],
  ["out of a buffer", Buffer.from([114, 101, 100]).toString()],
  ["decoded", new TextDecoder().decode(new Uint8Array([114, 101, 100]))],
  ["split", "blue,red".split(",")[1]],
  ["matched", /r.d/.exec("a red one")![0]],
  ["padded", "ed".padStart(3, "r")],
  ["a String object's value", new String("red").valueOf()],
  ["concat", "r".concat("e", "d")],
  ["normalized", "red".normalize("NFC")],
  ["at", "r" + "xe".at(-1) + "d"],
  ["base 36", (35509).toString(36)],
];
for (const [how, text] of ways) {
  console.log(how + ":", [isRed(text), rank(text), sameText(text, "red"), sameText("red", text), sameText(text, colorOf(0)), sameText(colorOf(3), text), normalize(text) === "red", lookUp(text), known.has(text), prices.get(text), text in table, Object.hasOwn(table, text), ["red"].includes(text), ["green", "red"].indexOf(text), text == "red", Object.is(text, "red"), text <= "red" && text >= "red", text.localeCompare("red")].join());
}

// Nearly the same text.
for (const text of [join("re", "d "), join("Re", "d"), join("re", ""), join("red", "\0"), "red́", join("", ""), "ｒｅｄ", join("gree", "n"), join("blu", "e")]) {
  console.log(JSON.stringify(text), isRed(text), rank(text), lookUp(text), known.has(text), sameText(text, "red"));
}

// The helper answers a literal or its parameter; the caller switches on the answer.
function describe(color: string): string {
  switch (normalize(color)) {
    case "red":
      return "warm";
    case "blue":
      return "cold";
    default:
      return "unknown";
  }
}
console.log(describe(join("crim", "son")), describe(join("r", "ed")), describe("red"), describe(join("bl", "ue")), describe(join("crimson", " ")), describe("crimson"));

// What is not a string at all where a literal was promised.
const untyped: (n: number) => unknown = n => (n === 7 ? new String("red") : n === 8 ? ["red"] : n === 9 ? { toString: () => "red" } : colorOf(n));
for (let n = 6; n < 10; n++) {
  const value = untyped(n) as string;
  console.log(typeof value, isRed(value), rank(value), value == "red", lookUp(value), known.has(value), `${value}` === "red");
}

// typeof answers literals too, and so do these.
function typeName(x: unknown): string {
  return typeof x;
}
function isFunctionName(name: string): boolean {
  return name === "function";
}
console.log(isFunctionName(typeName(() => 1)), isFunctionName(join("func", "tion")), typeName(null) === join("obj", "ect"), typeName(class {}) === join("fun", "ction"), typeName(1n) === join("big", "int"), sameText(typeName(undefined), join("undef", "ined")), sameText(kindOf(-1), join("nega", "tive")), sameText(kindOf(0), join("ze", "ro")));

// Numbers as text and text as keys of arrays.
const list = ["zero", "one", "two"];
function element(key: string): string | undefined {
  return (list as unknown as Record<string, string>)[key];
}
console.log(element("1"), element(join("", "1")), element(join("0", "1")), element(String(2)), element(join("len", "gth")), element("1.0"), element(join("-", "0")));
