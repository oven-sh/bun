// A body of bytes, held by everything that has a json(), read into a declared type, into `unknown` and by hand. All readers of one body have to agree, and an executable has to print what plain Bun prints.
//
//   the text     objects, arrays, numbers, texts, null; members in the declared order, in another order, missing, of another kind, twice, named __proto__, constructor or by an index; nested a little or a hundred deep;
//                numbers at the borders of int32 and of a double; escapes, pairs and halves of pairs written as \u; white space of every kind around it; cut off, with a comma too many, empty
//   the bytes    UTF-8; with a byte order mark in front, twice, or in the middle; Latin-1 letters, three-byte letters and pairs inside texts and keys; a byte that is no UTF-8 in a text, in a key, between members; a letter cut in two
//   the holder   Request, Response, Blob, a Response of a Blob, of an ArrayBuffer, of a typed array, of a text, of a stream that hands the bytes over in pieces of one to seven
//   the reader   json() into a declared object type, an array type, a union, `unknown`; text() and JSON.parse; bytes and a TextDecoder and JSON.parse
//   how often    once, or forty times in a loop with one odd body among them
import type { Random } from "./random";

const declared = `export {};
interface Order {
  id: number;
  name: string;
  tags: string[];
  inner: { x: number; y: number };
  note?: string;
}
type Row = [number, string];
type Either = { kind: "a"; a: number } | { kind: "b"; b: string };
`;

const helpers = `function describe(value: unknown): string {
  if (typeof value !== "object" || value === null) return typeof value + " " + (Object.is(value, -0) ? "-0" : String(value));
  let text: string;
  try {
    text = JSON.stringify(value);
  } catch (error) {
    text = (error as Error).name;
  }
  if (text.length > 160) text = text.slice(0, 80) + ".." + text.length + "#" + hashOf(text);
  return text + " " + Reflect.ownKeys(value).slice(0, 12).map(String).join() + " " + (Object.getPrototypeOf(value) === (Array.isArray(value) ? Array.prototype : Object.prototype));
}
function hashOf(text: string): number {
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = (Math.imul(hash, 31) + text.charCodeAt(i)) | 0;
  return hash;
}
async function attempt(read: () => Promise<unknown>): Promise<string> {
  try {
    return describe(await read());
  } catch (error) {
    return "throws " + (error as Error).name;
  }
}
function inPieces(bytes: Uint8Array<ArrayBuffer>, size: number): ReadableStream {
  let at = 0;
  return new ReadableStream({
    pull(controller) {
      if (at >= bytes.length) return controller.close();
      controller.enqueue(bytes.slice(at, (at += size)));
    },
  });
}
`;

const number = (random: Random) => random.pick(["0", "-0", "1", "-1", "7", "2147483647", "2147483648", "-2147483648", "-2147483649", "4294967296", "9007199254740993", "1e21", "1e-7", "1.5", "0.1", "1E400", "-1e400", "123456789012345678901234567890", "1.0", "10e-1"]);
const letters = ["a", "z", "Z", " ", "é", "ÿ", "ß", "€", "中", "\u{1f600}", "\u{10ffff}", "\\n", "\\\\", '\\"', "\\u0000", "\\u00e9", "\\ud83d\\ude00", "\\ud83d", "\\ude00", "\\u2028", "\\/", "\u007f"];
const text = (random: Random) => '"' + Array.from({ length: random.pick([0, 1, 1, 2, 3, 8, 40]) }, () => random.pick(letters)).join("") + '"';
const space = (random: Random) => random.pick(["", "", "", " ", "\n", "\t", "\r\n", "  "]);

function anything(random: Random, depth: number): string {
  const kind = random.below(depth > 2 ? 5 : 8);
  if (kind === 0) return number(random);
  if (kind === 1) return text(random);
  if (kind === 2) return random.pick(["null", "true", "false"]);
  if (kind === 3) return "[]";
  if (kind === 4) return "{}";
  if (kind === 5) return "[" + Array.from({ length: random.between(1, 4) }, () => anything(random, depth + 1)).join("," + space(random)) + "]";
  return "{" + Array.from({ length: random.between(1, 4) }, () => `${random.pick(['"id"', '"name"', '"x"', '"0"', '"1"', '"__proto__"', '"constructor"', '"length"', '""', text(random)])}:${space(random)}${anything(random, depth + 1)}`).join(",") + "}";
}

function order(random: Random): string {
  let members = [`"id":${number(random)}`, `"name":${text(random)}`, `"tags":[${Array.from({ length: random.below(4) }, () => text(random)).join(",")}]`, `"inner":{"x":${number(random)},"y":${number(random)}}`];
  if (random.chance(0.4)) members.push(`"note":${text(random)}`);
  const change = random.pick(["as declared", "as declared", "as declared", "another order", "one is missing", "one of another kind", "one twice", "one more", "inner in another order", "__proto__"]);
  if (change === "another order") members = random.shuffled(members);
  if (change === "one is missing") members.splice(random.below(members.length), 1);
  if (change === "one of another kind") members[random.below(members.length)] = `${random.pick(['"id"', '"name"', '"tags"', '"inner"'])}:${anything(random, 1)}`;
  if (change === "one twice") members.splice(random.below(members.length + 1), 0, random.pick(members));
  if (change === "one more") members.splice(random.below(members.length + 1), 0, `${random.pick(['"extra"', '"0"', '"é"', '"constructor"', '"toString"'])}:${anything(random, 1)}`);
  if (change === "inner in another order") members[3] = `"inner":{"y":${number(random)},"x":${number(random)}}`;
  if (change === "__proto__") members.splice(random.below(members.length + 1), 0, `"__proto__":${random.pick(["null", "{}", '{"id":5}', "[]", "1"])}`);
  return space(random) + "{" + members.join("," + space(random)) + "}" + space(random);
}

function written(random: Random): string {
  const whole = random.weighted<() => string>([
    [6, () => order(random)],
    [2, () => `[${number(random)},${text(random)}]`],
    [2, () => random.pick([`{"kind":"a","a":${number(random)}}`, `{"kind":"b","b":${text(random)}}`, `{"kind":"c"}`, `{"kind":"a","b":${text(random)}}`])],
    [3, () => anything(random, 0)],
    [1, () => "[".repeat(100) + number(random) + "]".repeat(100)],
    [1, () => '{"inner":'.repeat(60) + "null" + "}".repeat(60)],
    [1, () => random.pick(["", " ", "nul", "undefined", "NaN", "'a'", "{,}", "[1,]", '{"id":1,}', '{"id"}', "01", "1.", "+1", '"\t"', "{}{}", "[1] 2", '"\\x41"', '"\\ud83d'])],
  ])();
  if (random.chance(0.06)) return whole.slice(0, random.below(whole.length + 1));
  return whole;
}

/** The body as an expression that gives a Uint8Array. */
function bytesOf(random: Random): string {
  const json = written(random);
  const encoded = [...new TextEncoder().encode(json)];
  const mark = [0xef, 0xbb, 0xbf];
  const damage = random.pick(["none", "none", "none", "none", "none", "a mark in front", "a mark in front", "two marks", "a mark inside", "a mark at the end", "a byte that is no UTF-8", "a letter cut in two", "an overlong form", "a half of a pair as three bytes", "a mark of UTF-16"]);
  const somewhere = () => random.below(encoded.length + 1);
  if (damage === "a mark in front") encoded.unshift(...mark);
  if (damage === "two marks") encoded.unshift(...mark, ...mark);
  if (damage === "a mark inside") encoded.splice(somewhere(), 0, ...mark);
  if (damage === "a mark at the end") encoded.push(...mark);
  if (damage === "a byte that is no UTF-8") encoded.splice(somewhere(), 0, random.pick([0x80, 0xbf, 0xc0, 0xf8, 0xff, 0xfe]));
  if (damage === "a letter cut in two") {
    const lead = encoded.findIndex(byte => byte >= 0xc2);
    if (lead >= 0) encoded.splice(lead + 1, 1);
  }
  if (damage === "an overlong form") encoded.splice(somewhere(), 0, 0xc0, 0xaf);
  if (damage === "a half of a pair as three bytes") encoded.splice(somewhere(), 0, 0xed, 0xa0, 0x80);
  if (damage === "a mark of UTF-16") encoded.unshift(...random.pick([[0xff, 0xfe], [0xfe, 0xff]]));
  return `new Uint8Array([${encoded.join(",")}])`;
}

const holders: readonly (readonly [string, (random: Random) => string])[] = [
  ["request", () => `new Request("http://localhost/", { method: "POST", body: bytes })`],
  ["response", () => `new Response(bytes)`],
  ["blob", () => `new Blob([bytes])`],
  ["blob in two", () => `new Blob([bytes.subarray(0, bytes.length >> 1), bytes.subarray(bytes.length >> 1)])`],
  ["response of a blob", () => `new Response(new Blob([bytes]))`],
  ["response of a buffer", () => `new Response(bytes.buffer.slice(0) as ArrayBuffer)`],
  ["response of a view", () => `new Response(new DataView(bytes.buffer))`],
  ["response of a stream", random => `new Response(inPieces(bytes, ${random.between(1, 7)}))`],
  ["request of a stream", random => `new Request("http://localhost/", { method: "POST", body: inPieces(bytes, ${random.between(1, 7)}) })`],
  ["response of a text", () => `new Response(new TextDecoder().decode(bytes))`],
  ["a clone", () => `new Response(bytes).clone()`],
];

const readers: readonly (readonly [string, string])[] = [
  ["order", `(await holder.json()) as Order`],
  ["annotated", `((order: Order) => order)(await holder.json())`],
  ["field", `((await holder.json()) as Order).inner.x`],
  ["name", `((await holder.json()) as Order).name`],
  ["row", `(await holder.json()) as Row`],
  ["rows", `(await holder.json()) as Order[]`],
  ["either", `(await holder.json()) as Either`],
  ["unknown", `(await holder.json()) as unknown`],
  ["text", `JSON.parse(await holder.text()) as unknown`],
  ["typed text", `JSON.parse(await holder.text()) as Order`],
  ["decoded", `JSON.parse(new TextDecoder().decode(await holder.arrayBuffer())) as unknown`],
  ["the text itself", `await holder.text()`],
];

export function generate(random: Random): string {
  const lines: string[] = [declared, helpers];
  const cases = random.between(3, 8);
  for (let index = 0; index < cases; index++) {
    const [holderName, holder] = random.pick(holders);
    const chosen = random.sample(readers, random.between(2, 5));
    const make = holder(random);
    lines.push(`async function case${index}(bytes: Uint8Array<ArrayBuffer>, label: string) {`);
    for (const [readerName, reader] of chosen) lines.push(`  say(label, ${JSON.stringify(`${holderName} ${readerName}`)}, await attempt(async () => {\n    const holder = ${make};\n${holderName.startsWith("blob") ? "    // @ts-ignore: not every set of types knows the json() of a Blob\n" : ""}    return ${reader};\n  }));`);
    lines.push(`}`);
    if (random.chance(0.3)) {
      // One function meets forty bodies of one form, and one odd one among them.
      const usual = bytesOf(random);
      const odd = bytesOf(random);
      const at = random.below(40);
      lines.push(`for (let turn = 0; turn < 40; turn++) {\n  const bytes = turn === ${at} ? ${odd} : ${usual};\n  if (turn === ${at} || turn === 0 || turn === 39) await case${index}(bytes, "${index}." + turn);\n  else {\n    quiet = true;\n    await case${index}(bytes, "");\n    quiet = false;\n  }\n}`);
    } else for (let body = random.between(1, 3); body > 0; body--) lines.push(`await case${index}(${bytesOf(random)}, "${index}.${body}");`);
  }
  lines.splice(2, 0, `let quiet = false;\nfunction say(...words: string[]) {\n  if (!quiet) console.log(words.join(" "));\n}\n`);
  return lines.join("\n") + "\n";
}
