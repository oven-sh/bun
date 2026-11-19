// `head + tail === "literal"`. A string that was just joined is kept in pieces, and a comparison with a short literal may read
// the pieces without joining them. Each scene joins two to four pieces in one of several ways, some of them empty, slices of
// longer strings, wide characters or themselves joined, and compares the result with literals of 0 to 12 characters that are
// equal, differ in one place, or are shorter or longer: by ===, !==, ==, a switch, includes, a table. The joined string is also
// used afterwards, so that a comparison that changed it would show.
import type { Random } from "./random";

const words = [
  "GET",
  "POST",
  "a",
  "ab",
  "abcdefgh",
  "abcdefg",
  "abcdefghi",
  "content",
  "x-y",
  "",
  "ok",
  "été",
  "你好",
  "naïve",
  "12345678",
  "true",
  "null",
];

/** Expressions that join the pieces P0, P1 .. into one string. */
const joins = [
  (pieces: string[]) => pieces.join(" + "),
  (pieces: string[]) => pieces.join(" + "),
  (pieces: string[]) => "`" + pieces.map(piece => "${" + piece + "}").join("") + "`",
  (pieces: string[]) => `${pieces[0]}.concat(${pieces.slice(1).join(", ")})`,
  (pieces: string[]) => `[${pieces.join(", ")}].join("")`,
  (pieces: string[]) => pieces.reduce((joined, piece) => `(${joined} + ${piece})`),
  (pieces: string[]) => pieces.reduceRight((joined, piece) => `(${piece} + ${joined})`),
];

/** Expressions for one piece whose value is TEXT. */
const forms = [
  (text: string) => `word(${JSON.stringify(text)})`,
  (text: string) => `word(${JSON.stringify(text)})`,
  (text: string) => JSON.stringify(text),
  (text: string) => `word(${JSON.stringify("<<" + text + ">>")}).slice(2, ${2 + text.length})`,
  (text: string) => `word(${JSON.stringify(text + "tail")}).substring(0, ${text.length})`,
  (text: string) =>
    text.length > 1
      ? `(word(${JSON.stringify(text.slice(0, 1))}) + word(${JSON.stringify(text.slice(1))}))`
      : `word(${JSON.stringify(text)})`,
  (text: string) => `String(word(${JSON.stringify(text)}))`,
];

/** Cuts the word into so many pieces, some of which may be empty. */
function cut(random: Random, word: string, count: number): string[] {
  const at = Array.from({ length: count - 1 }, () => random.between(0, word.length)).sort((a, b) => a - b);
  return [0, ...at].map((from, index) => word.slice(from, [...at, word.length][index]));
}

/** Literals near the word: itself, one character changed, one more, one fewer. */
function near(random: Random, word: string): string[] {
  const place = word.length ? random.between(0, word.length - 1) : 0;
  return [
    word,
    word.slice(0, place) + "#" + word.slice(place + 1),
    word + "x",
    word.slice(0, -1),
    word.toUpperCase(),
    word.slice(1),
    random.pick(words),
  ];
}

export function generate(random: Random, typed: boolean): string {
  const as = (type: string) => (typed ? `: ${type}` : "");
  const scenes: string[] = [];
  for (let scene = 0, total = random.between(3, 6); scene < total; scene++) {
    const word = random.pick(words);
    const joined = random.pick(joins)(cut(random, word, random.between(2, 4)).map(piece => random.pick(forms)(piece)));
    const literals = random
      .sample([...new Set(near(random, word))], random.between(2, 4))
      .map(text => JSON.stringify(text));
    const asked = random.sample(
      [
        ...literals.map(literal => `joined === ${literal}`),
        ...literals.map(literal => `${literal} === joined`),
        `joined !== ${literals[0]}`,
        `joined == ${literals[0]}`,
        `(${joined}) === ${literals[0]}`,
        `(${joined}) === ${literals[1]}`,
        `[${literals.join(", ")}].includes(joined)`,
        `[${literals.join(", ")}].indexOf(joined)`,
        `picked${scene}(joined)`,
        `({ ${literals.map((literal, at) => `[${literal}]: ${at}`).join(", ")} })[joined]`,
        `joined === joined`,
        `joined === other`,
        `joined < ${literals[0]}`,
        `Object.is(joined, ${literals[0]})`,
        `joined.length`,
      ],
      random.between(3, 6),
    );
    scenes.push(`function picked${scene}(text${as("string")})${as("number")} {
  switch (text) {
${literals.map((literal, at) => `    case ${literal}:\n      return ${at};`).join("\n")}
    default:
      return -1;
  }
}
function scene${scene}()${as("string")} {
  let last = "";
  for (let i = 0; i < ${random.pick([1, 3, 300])}; i++) {
    const joined = ${joined};
    const other = ${joined};
    last = noted([${asked.join(", ")}].join());
    ${random.pick(["", "", "last += joined.charCodeAt(0);", "last += joined.toUpperCase();", "kept.push(joined);", 'last += joined + "!";'])}
  }
  return last + " " + counted();
}
console.log("scene ${scene}", scene${scene}(), kept.length, kept.splice(0).at(-1));`);
  }
  return `// Every round should answer alike: how many different answers there were, and how long they are together.
const rounds = new Set${typed ? "<string>" : ""}();
function noted(answer${as("string")})${as("string")} {
  rounds.add(answer);
  return answer;
}
function counted()${as("string")} {
  const said = rounds.size + ":" + [...rounds].join("").length;
  rounds.clear();
  return said;
}
const kept${as("string[]")} = [];
const word = (text${as("string")})${as("string")} => process.argv[9] ?? text;
${scenes.join("\n")}
${typed ? "export {};\n" : ""}`;
}
