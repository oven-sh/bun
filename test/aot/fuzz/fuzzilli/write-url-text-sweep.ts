// A URL, or the parameters of a query, made of a text and asked one question: the question, times the texts. Each program asks one question of up to 262,144 texts that it makes itself, and is built alone.
//
//   bun write-url-text-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<question>--<texts>--part-<n>.ts
//   bun write-url-text-sweep.ts count                                    the number of programs
//   bun write-url-text-sweep.ts texts                                    the number of questions that they ask
//   bun write-url-text-sweep.ts named <pattern> <folder> [most]
//
// A compiler may answer such a question out of the text and never make the object. Then it has to know for which texts the answer is a piece of the text as it stands: not where a path holds `.` or `%2e`
// behind a slash, a backslash, a tab, a character that is written otherwise in a URL; not where a host is spelled otherwise than it is kept; not where a parameter holds `+` or `%`. The texts are every
// string of up to so many places over a few characters that matter, between a head and a tail, and rows of pieces of which every choice is taken: the lengths around which offsets no longer fit their
// bits are such rows. A program prints a line for every 1,024 texts, the number of the block and a digest of the answers; called with the number of a block it prints that block text by text. The parameter
// is written as a text, and the texts are joined out of lists: a compiler that reads the bytes of a text may pass by one that is still in pieces.
import { mkdirSync, writeFileSync } from "fs";

const written = `"http://base.example/dir/file?q=1#f"`;
// What is asked, and of which texts: whole URLs, texts that stand against a base, or queries.
const questions: [string, "whole" | "against-a-base" | "query", string][] = [
  ["the-pathname", "whole", "return new URL(text).pathname;"],
  ["the-search", "whole", "return new URL(text).search;"],
  ["a-parameter", "whole", `return new URL(text).searchParams.get("a");`],
  ["a-parameter-under-a-name-from-data", "whole", "return new URL(text).searchParams.get(name);"],
  ["the-parameter-without-a-name", "whole", `return new URL(text).searchParams.get("");`],
  ["whether-a-parameter-is-there", "whole", `return new URL(text).searchParams.has("a");`],
  [
    "four-parts-of-one",
    "whole",
    `const url = new URL(text);\n  return [url.pathname, url.search, url.searchParams.get("a"), url.searchParams.has("b")];`,
  ],
  [
    "three-parameters-of-one",
    "whole",
    `const query = new URL(text).searchParams;\n  return [query.get("a"), query.get("b"), query.get("ab"), query.has("")];`,
  ],
  ["the-keys-of-the-parameters", "whole", "return [...new URL(text).searchParams.keys()];"],
  ["the-number-of-the-parameters", "whole", "return new URL(text).searchParams.size;"],
  ["the-text-of-the-parameters", "whole", "return new URL(text).searchParams.toString();"],
  ["the-pathname-against-a-written-base", "against-a-base", `return new URL(text, ${written}).pathname;`],
  ["the-search-against-a-written-base", "against-a-base", `return new URL(text, ${written}).search;`],
  ["a-parameter-against-a-written-base", "against-a-base", `return new URL(text, ${written}).searchParams.get("a");`],
  ["the-pathname-against-a-base-from-data", "against-a-base", "return new URL(text, String(base)).pathname;"],
  ["the-search-against-a-base-from-data", "against-a-base", "return new URL(text, String(base)).search;"],
  [
    "a-parameter-against-a-base-from-data",
    "against-a-base",
    `return new URL(text, String(base)).searchParams.get("a");`,
  ],
  ["a-parameter-of-a-query", "query", `return new URLSearchParams(text).get("a");`],
  ["the-parameter-without-a-name-of-a-query", "query", `return new URLSearchParams(text).get("");`],
  ["whether-a-parameter-of-a-query-is-there", "query", `return new URLSearchParams(text).has("a");`],
  ["the-number-of-a-query", "query", "return new URLSearchParams(text).size;"],
  ["the-keys-of-a-query", "query", "return [...new URLSearchParams(text).keys()];"],
  ["the-values-of-a-query", "query", "return [...new URLSearchParams(text).values()];"],
  ["the-entries-of-a-query", "query", "return [...new URLSearchParams(text)];"],
  [
    "a-walk-of-a-query",
    "query",
    `const seen: string[] = [];\n  new URLSearchParams(text).forEach((value, key) => seen.push(key + "=" + value));\n  return seen;`,
  ],
  ["the-text-of-a-query", "query", "return new URLSearchParams(text).toString();"],
];

type Piece = string | [string, number];
// Either every string of up to `most` places over `letters` between a head and a tail, or one piece out of every row. A piece written as a pair is a text repeated.
type Texts = { name: string; fits: ("whole" | "against-a-base" | "query")[] } & ({ head: string; letters: string[]; most: number; tail: string } | { rows: Piece[][] }); // prettier-ignore

const many = ["/", ".", "%", "?", "#", "a", "A", "2", "e", ";", "\\", " ", "\t", "'", "+", "&", "=", "~", "|", "é"];
const few = ["/", ".", "%", "?", "#", "a", "2", "e", "\\", "="];
const ofQueries = ["a", "b", "=", "&", "+", "%", "#", "?", ";", "2"];
const upTo = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, at) => from + at);

const texts: Texts[] = [
  { name: "paths-of-four-places", fits: ["whole"], head: "http://h.example/", letters: many, most: 4, tail: "" },
  { name: "paths-of-six-places", fits: ["whole"], head: "http://h.example/", letters: few, most: 6, tail: "" },
  {
    name: "paths-behind-a-folder",
    fits: ["whole"],
    head: "https://h.example:8080/d/",
    letters: many,
    most: 3,
    tail: "/t?a=1",
  },
  {
    name: "hosts-of-five-places",
    fits: ["whole"],
    head: "http://",
    letters: ["a", "1", "0", "-", ".", ":", "x", "n", "A", "@", "%", "[", "/", "?"],
    most: 5,
    tail: "/p?a=1",
  },
  {
    name: "queries-of-six-places",
    fits: ["whole"],
    head: "http://h.example/p?",
    letters: ofQueries,
    most: 6,
    tail: "",
  },
  { name: "queries-of-four-places", fits: ["whole"], head: "http://h.example/p?", letters: many, most: 4, tail: "" },
  {
    name: "queries-in-front-of-a-parameter",
    fits: ["whole"],
    head: "http://h.example/p?",
    letters: ofQueries,
    most: 5,
    tail: "&a=z",
  },
  {
    name: "heads",
    fits: ["whole", "against-a-base"],
    rows: [
      ["", " ", "\t", "\n"],
      ["http", "https", "HTTP", "Http", "htt", "httpx", "ftp", "file", "ws", "data", "h"],
      [":", "", "::", " :"],
      ["//", "/", "", "///", "\\\\", "/\\", "\\/"],
      [
        "h.example",
        "H.example",
        "h",
        "1.2.3.4",
        "1.2.3",
        "[::1]",
        "u@h",
        "h:80",
        "h:",
        "",
        "xn--a",
        "a--b",
        "a-",
        "-a",
        "a..b",
        "a.",
      ],
      ["/p?a=1", "", "/", "?a=1", "#f", "/p", "/p?a=1 "],
    ],
  },
  {
    name: "lengths",
    fits: ["whole"],
    rows: [
      ["http://"],
      upTo(113, 123).map((length): Piece => ["a", length]),
      ["/"],
      upTo(3945, 3985).map((length): Piece => ["p", length]),
      ["", "?", "?a=1", "?a=1#f", "#f", "?b=2&a=1", "/q"],
    ],
  },
  {
    name: "lengths-of-queries",
    fits: ["whole"],
    rows: [
      ["http://h.example/p?"],
      ["", "b=2&", "a=0&"],
      upTo(4060, 4085).map((length): Piece => ["c", length]),
      ["", "&a=1", "=1&a=2", "&a", "#f", "&a=1#f"],
    ],
  },
  { name: "four-places", fits: ["against-a-base"], head: "", letters: many, most: 4, tail: "" },
  { name: "six-places", fits: ["against-a-base"], head: "", letters: few, most: 6, tail: "" },
  { name: "four-places-behind-a-slash", fits: ["against-a-base"], head: "/", letters: many, most: 4, tail: "" },
  {
    name: "whole-ones-of-four-places",
    fits: ["against-a-base"],
    head: "http://h.example/",
    letters: many,
    most: 4,
    tail: "",
  },
  {
    name: "lengths-behind-a-slash",
    fits: ["against-a-base"],
    rows: [["/", ""], upTo(4080, 4100).map((length): Piece => ["p", length]), ["", "?", "?a=1", "#f", "?a=1#f"]],
  },
  { name: "six-places", fits: ["query"], head: "", letters: ofQueries, most: 6, tail: "" },
  { name: "four-places", fits: ["query"], head: "", letters: many, most: 4, tail: "" },
  { name: "five-places-behind-a-question-mark", fits: ["query"], head: "?", letters: ofQueries, most: 5, tail: "" },
  { name: "five-places-in-front-of-a-parameter", fits: ["query"], head: "", letters: ofQueries, most: 5, tail: "&a=z" },
  {
    name: "lengths",
    fits: ["query"],
    rows: [
      ["", "?", "b=2&", "a=0&"],
      upTo(4080, 4100).map((length): Piece => ["c", length]),
      ["", "&a=1", "=1&a=2", "&a", "=1"],
    ],
  },
];

const inBlock = 1024;
const blocksInPart = 256;
const numberOf = (one: Texts) => ("rows" in one ? one.rows.reduce((all, row) => all * row.length, 1) : upTo(0, one.most).reduce((all, places) => all + one.letters.length ** places, 0)); // prettier-ignore

const programs: [number, number, number][] = questions.flatMap(([, kind], question) =>
  texts.flatMap((one, family) =>
    one.fits.includes(kind)
      ? upTo(0, Math.ceil(numberOf(one) / (inBlock * blocksInPart)) - 1).map((part): [number, number, number] => [
          question,
          family,
          part,
        ])
      : [],
  ),
);
const all = programs.length;

const fromData = (value: unknown) => `JSON.parse(${JSON.stringify(JSON.stringify(value))})`;

function write(at: number): { name: string; text: string } {
  const [question, family, part] = programs[at];
  const [asked, , body] = questions[question];
  const one = texts[family];
  const total = numberOf(one);
  const textAt =
    "rows" in one
      ? `const rows: (string | [string, number])[][] = ${fromData(one.rows)};
function textAt(index: number): string {
  const pieces: string[] = [];
  for (const row of rows) {
    const piece = row[index % row.length];
    index = Math.floor(index / row.length);
    pieces.push(typeof piece === "string" ? piece : piece[0].repeat(piece[1]));
  }
  return pieces.join("");
}`
      : `const letters: string[] = ${fromData(one.letters)};
const head: string = ${fromData(one.head)};
const tail: string = ${fromData(one.tail)};
function textAt(index: number): string {
  let places = 0;
  for (let span = 1; index >= span; span *= letters.length) {
    index -= span;
    places++;
  }
  const pieces: string[] = [head];
  for (let place = 0; place < places; place++) {
    pieces.push(letters[index % letters.length]);
    index = Math.floor(index / letters.length);
  }
  pieces.push(tail);
  return pieces.join("");
}`;
  const text = `const name: string = ${fromData("a")};
const base: string = ${fromData("http://base.example/dir/file?q=1#f")};
${textAt}
function ask(text: string): unknown {
  ${body}
}
function answerOf(text: string): string {
  try {
    return JSON.stringify(ask(text)) ?? "undefined";
  } catch (error) {
    return "throws " + (error as Error).name + ": " + (error as Error).message;
  }
}
const only = process.argv[2] === undefined ? -1 : Number(process.argv[2]);
for (let block = ${part * blocksInPart}; block < ${Math.min((part + 1) * blocksInPart, Math.ceil(total / inBlock))}; block++) {
  if (only >= 0 && block !== only) continue;
  let digest = 2166136261;
  for (let index = block * ${inBlock}; index < Math.min((block + 1) * ${inBlock}, ${total}); index++) {
    const asked = textAt(index);
    const answer = answerOf(asked);
    if (only >= 0) console.log(JSON.stringify(asked.length > 200 ? asked.length + " places: " + asked.slice(0, 20) + " .. " + asked.slice(-20) : asked), answer.length > 200 ? answer.length + " places: " + answer.slice(0, 20) + " .. " + answer.slice(-20) : answer);
    for (let at = 0; at < answer.length; at++) digest = Math.imul(digest ^ answer.charCodeAt(at), 16777619);
    digest = Math.imul(digest ^ 10, 16777619);
  }
  if (only < 0) console.log(block, digest >>> 0);
}
export {};
`;
  return { name: `${asked}--${one.name}--part-${part}.ts`, text };
}

const pad = (at: number) => String(at).padStart(4, "0");
if (process.argv[2] === "count") console.log(all);
else if (process.argv[2] === "texts")
  console.log(questions.reduce((sum, [, kind]) => sum + texts.reduce((some, one) => some + (one.fits.includes(kind) ? numberOf(one) : 0), 0), 0)); // prettier-ignore
else if (process.argv[2] === "named") {
  const [pattern, folder, atMost] = [new RegExp(process.argv[3]), process.argv[4], Number(process.argv[5] ?? 500)];
  mkdirSync(folder, { recursive: true });
  let laid = 0;
  for (let at = 0; at < all && laid < atMost; at++) {
    const program = write(at);
    if (!pattern.test(program.name)) continue;
    writeFileSync(`${folder}/${pad(at)}-${program.name}`, program.text);
    laid++;
  }
  console.log(laid);
} else {
  const [folder, from, count, stride] = [process.argv[2], Number(process.argv[3] ?? 0), Number(process.argv[4] ?? all), Number(process.argv[5] ?? 1)]; // prettier-ignore
  mkdirSync(folder, { recursive: true });
  for (let step = 0; step < Math.min(count, all); step++) {
    const at = (from + step * stride) % all;
    const program = write(at);
    writeFileSync(`${folder}/${pad(at)}-${program.name}`, program.text);
  }
  console.log(Math.min(count, all));
}
