// A string is stored with one or with two bytes a character, and a text of plain letters can be stored either way: it takes
// two bytes when it was cut out of a text that holds a character such as a dash. Each scene has the same text in both forms.
// It cuts slices out of one of them and joins them with other texts, then does something with the base or with a slice that
// may exchange its storage for an equal text of the other form (it is used as a property name while the other form is one
// already, it is a key of a Map or a Set, it is compared, it goes to a builtin), and only then reads the joined text for the
// first time. The scenes run in functions that are called once, twice or in a loop, and at the top level.
import type { Random } from "./random";

const texts = [
  "/srv/app/src/index.ts",
  "/srv/app/src/index.ts",
  "alpha.beta.gamma",
  "key",
  "a",
  "some-longer-name-with-many-parts/and.a.folder/settings.config.json",
  "x.y",
  "12",
  "name of a thing",
  "ab/cd/ef/gh/ij/kl",
  "café/crème.txt",
];

const quoted = (text: string) => JSON.stringify(text);

/** Expressions for TEXT that may be stored with two bytes a character. */
const wide = [
  (text: string) => `JSON.parse(${quoted(`{"note":"a — b","file":${quoted(text)}}`)}).file`,
  (text: string) => `JSON.parse(${quoted(`{"note":"a — b","file":${quoted(text)}}`)}).file`,
  (text: string) => `JSON.parse(${quoted(`["—",${quoted(text)}]`)})[1]`,
  (text: string) => `("\\u2014" + word(${quoted(text)})).slice(1)`,
  (text: string) => `(word(${quoted(text)}) + "\\u2014").slice(0, -1)`,
  (text: string) => `word(${quoted("—|" + text)}).split("|")[1]`,
  (text: string) => `String.fromCharCode(0x2014, ${[...text].map(each => each.charCodeAt(0)).join(", ")}).slice(1)`,
  (text: string) =>
    `new TextDecoder("utf-16le").decode(Uint16Array.of(${[...text].map(each => each.charCodeAt(0)).join(", ")}))`,
  (text: string) => `Buffer.from(${quoted(text)}, "utf16le").toString("utf16le")`,
  (text: string) => `word(${quoted("—" + text)}).substring(1)`,
  (text: string) => `word(${quoted(text + "—")}).replace("\\u2014", "")`,
];

/** Expressions for TEXT that may be stored with one byte a character. */
const narrow = [
  (text: string) => quoted(text),
  (text: string) => `word(${quoted(text)})`,
  (text: string) => `JSON.parse(${quoted(`{"file":${quoted(text)}}`)}).file`,
  (text: string) => `word(${quoted(text)}).split("/").join("/")`,
  (text: string) => `word(${quoted(text)}).split("").join("")`,
  (text: string) => `(" " + word(${quoted(text)})).slice(1)`,
  (text: string) => `String.fromCharCode(${[...text].map(each => each.charCodeAt(0)).join(", ")})`,
  (text: string) => `Buffer.from(${quoted(text)}, "latin1").toString("latin1")`,
  (text: string) => `word(${quoted(text)}).slice(0, 1) + word(${quoted(text)}).slice(1)`,
  (text: string) => `[...word(${quoted(text)})].join("")`,
  (text: string) => `JSON.parse(${quoted(`{"note":"a — b","file":${quoted(text)}}`)}).file.split("/").join("/")`,
  (text: string) => `JSON.parse(${quoted(`{"note":"a — b","file":${quoted(text)}}`)}).file.split("/").join("/")`,
];

const added = [
  '".js"',
  '".js"',
  '""',
  '"x"',
  '"/"',
  '"\\u00e9"',
  '"\\u2014"',
  '"-a-text-of-more-than-sixteen-characters"',
  "other",
  "other.slice(1)",
  "String(turn)",
];

/** Expressions that build a text out of `p`. A and B are places in it, LIT and MORE are other texts. */
const built = [
  'p.slice(0, p.lastIndexOf(".")) + LIT',
  'p.slice(0, p.lastIndexOf(".")) + LIT',
  "p.slice(A, B) + LIT",
  "p.slice(A, B) + LIT",
  "LIT + p.slice(A)",
  "p.slice(0, A) + LIT + p.slice(A)",
  "p.slice(0, A) + LIT + (MORE + p.slice(A))",
  "p.slice(0, A) + p.slice(A, B) + LIT + p.slice(B) + MORE",
  "`${p.slice(A)}${LIT}`",
  "`${LIT}${p.slice(0, B)}${MORE}`",
  "p + LIT",
  "LIT + p",
  "p + p",
  "p.substring(A) + other.substring(A)",
  "p.slice(A).concat(LIT)",
  "p.slice(A, B).repeat(2)",
  "p.slice(A).padStart(B + 9, LIT)",
  "p.slice(A).padEnd(B + 9, LIT)",
  "p.slice(A)",
  "p.slice(A).slice(1)",
  "[p.slice(0, A), p.slice(A)].join(LIT)",
  "p.substr(A, 4) + LIT",
  'p.split("/").join("/") + LIT',
  "p.trim() + LIT",
];

/** Expressions that do something with `it`, the base or a slice, between the building and the first read. */
const events = [
  "table[it]",
  "table[it]",
  "table[it]",
  "table[it]",
  "it in table",
  "Object.hasOwn(table, it)",
  '(table[it] = "stored")',
  "({ [it]: 1 })[it]",
  "map.get(it)",
  "set.has(it)",
  "it === other",
  "it < other",
  "it.localeCompare(other)",
  "JSON.stringify(it).length",
  "Symbol.for(it).description === other",
  "encodeURIComponent(it).length",
  "Reflect.has(table, it)",
  "Object.keys({ [it]: 1 })[0] === other",
  "it.length",
  "0",
];

/** Expressions that read `out`. */
const reads = [
  "out[K]",
  "out.charCodeAt(K)",
  "out.codePointAt(K)",
  "out.at(-1)",
  "out.charAt(K)",
  "out.endsWith(LIT)",
  "out.endsWith(LIT)",
  "out.startsWith(HEAD)",
  "out.includes(MID)",
  "out.indexOf(MID)",
  'out.lastIndexOf("/")',
  "out.slice(1, 5)",
  "[...out].length",
  "JSON.stringify(out)",
  "out.length",
  "out === WHOLE",
  "out === WHOLE + LIT",
  "table[out]",
  "out in table",
  'out.split("/").length',
  "out.toUpperCase()",
  "out < WHOLE",
  "new Map([[out, 1]]).has(WHOLE)",
  'out.replace("/", "+")',
  "/[a-z]+$/.test(out)",
  "encodeURIComponent(out)",
  "Buffer.from(out).length",
  "new TextEncoder().encode(out).length",
  'out + "!"',
  "out.normalize()",
  "out[K] === other[K]",
  "out[K] === other[K]",
  "out[K] === p[K]",
  "out.charAt(K) === other.charAt(K)",
  "out[0] === LIT[0]",
  "out[K] !== other[0]",
];

export function generate(random: Random, typed: boolean): string {
  const as = (type: string) => (typed ? `: ${type}` : "");
  const scenes: string[] = [];
  for (let scene = 0, total = random.between(3, 7); scene < total; scene++) {
    const text = random.pick(texts);
    const from = random.below(Math.min(text.length, 6));
    const to = random.between(from, text.length);
    const isWideFirst = random.chance(0.5);
    const isOnSlice = random.chance(0.3);
    const name = isOnSlice ? text.slice(from, to) : text;
    // The form that is a property name already, and the form that the scene works on.
    const named = random.chance(0.85) ? random.pick(isWideFirst ? wide : narrow)(name) : undefined;
    const base = () => random.pick(random.chance(0.85) === isWideFirst ? narrow : wide)(text);
    const literal = random.pick(added);
    const fill = (code: string) =>
      code
        .replaceAll("LIT", literal)
        .replaceAll("MORE", random.pick(added))
        .replaceAll("WHOLE", quoted(text))
        .replaceAll("HEAD", quoted(text.slice(0, 2)))
        .replaceAll("MID", quoted(text.slice(1, 4)))
        .replace(/\bA\b/g, String(from))
        .replace(/\bB\b/g, String(to))
        .replace(/\bK\b/g, String(random.below(text.length + 2)))
        .replace(/\b(table|map|set|other)\b/g, `$1${scene}`);
    const shape = isOnSlice
      ? random.pick([
          "part + LIT",
          "LIT + part",
          "part + LIT + MORE",
          "part + part",
          "`${part}${LIT}`",
          "part.slice(1) + LIT",
          "part",
        ])
      : random.pick(built);
    const event = fill(random.pick(events).replace(/\bit\b/g, isOnSlice ? "part" : "p"));
    const body = `${isOnSlice ? `const part = p.slice(${from}, ${to});\n  ` : ""}const out = ${fill(shape)};
  const hit = ${event};
  const answer = ${fill(random.pick(reads))};
  const next = ${fill(random.pick(reads))};`;
    const answers = `[answer, next, hit, codes(out), codes(p)]`;
    const place = random.pick(["once", "once", "once", "twice", "loop", "loop", "top"]);
    const rounds = random.pick([3, 40, 300]);
    scenes.push(`const other${scene}${as("string")} = ${random.pick(random.chance(0.5) ? wide : narrow)(text)};
const table${scene}${as("Record<string, unknown>")} = { ${named === undefined ? "" : `[${named}]: "cached"`} };
const map${scene} = new Map${typed ? "<string, unknown>" : ""}([[${random.pick(isWideFirst ? wide : narrow)(name)}, "in the map"]]);
const set${scene} = new Set${typed ? "<string>" : ""}([${random.pick(isWideFirst ? wide : narrow)(name)}]);
${
  place === "top"
    ? `{
  const turn = 0;
  const p${as("string")} = ${base()};
  ${body}
  console.log("scene ${scene}", JSON.stringify(${answers}));
}`
    : `function scene${scene}(p${as("string")}, turn${as("number")})${as("string")} {
  ${body}
  return JSON.stringify(${answers});
}
${
  place === "loop"
    ? `{
  const seen = new Map${typed ? "<string, number>" : ""}();
  for (let turn = 0; turn < ${rounds}; turn++) {
    const said = scene${scene}(${base()}, turn % 3);
    seen.set(said, (seen.get(said) ?? 0) + 1);
  }
  for (const [said, times] of seen) console.log("scene ${scene}", times, said);
}`
    : `console.log("scene ${scene}", scene${scene}(${base()}, 0));${place === "twice" ? `\nconsole.log("scene ${scene}", scene${scene}(${base()}, 1));` : ""}`
}`
}`);
  }
  return `const word${as("(text: string) => string")} = Function("text", "return text")${typed ? " as (text: string) => string" : ""};
function codes(text${as("string")})${as("string")} {
  let all = "";
  for (let at = 0; at < text.length; at++) all += text.charCodeAt(at).toString(36) + ".";
  return all;
}
${scenes.join("\n")}
${typed ? "export {};\n" : ""}`;
}
