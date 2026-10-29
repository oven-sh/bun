// The programs of nothing-throws-because-of-a-type about `new URLSearchParams(x)` and `new URL(x)`.
// Both take whatever they are given: a string is parsed, a record or a list of pairs is walked, anything else is turned into a string first. What the type of `x` says decides nothing.
// Each type that `x` may be declared with meets each kind of value, which comes through `any`, and each way to ask the object that was made.
// EVERY CASE HAS A FUNCTION OF ITS OWN: a function that sees two kinds of values expects less of them. It is called from a loop, as code that is worth compiling well is.
import type { WrittenProgram } from "../generate";

type Declared = { file: string; type: string; fits: string; cast?: boolean };
type Family = {
  made: string;
  declared: Declared[];
  arriving: Record<string, string>;
  asked: Record<string, string>;
};

const families: Family[] = [
  {
    made: "URLSearchParams",
    declared: [
      { file: "a-string", type: "string", fits: `"p=1&q=2"` },
      { file: "a-record", type: "Record<string, string>", fits: `{ p: "1" }` },
      { file: "a-list-of-pairs", type: "string[][]", fits: `[["p", "1"]]` },
      { file: "search-params", type: "URLSearchParams", fits: `new URLSearchParams("p=1")` },
      { file: "a-number", type: "number", fits: "5", cast: true },
      { file: "a-string-or-undefined", type: "string | undefined", fits: `"p=1"` },
      { file: "a-string-or-a-record", type: "string | Record<string, string>", fits: `"p=1"` },
      { file: "unknown", type: "unknown", fits: `"p=1"`, cast: true },
    ],
    arriving: {
      "a plain query": `"p=1&q=2"`,
      "a query behind a question mark": `"?p=1&q=2"`,
      "an escaped query": `"p=%20a&q=b+c"`,
      "the empty string": `""`,
      "a string that is put together": `"p=1" + "&q=" + process.argv.length`,
      "a string of wide characters": `"p=\\u4e2d&q=2"`,
      "names without values": `"p&q"`,
      "a number": "5",
      "a record": `{ p: "x", length: 3 }`,
      "a list of pairs": `[["p", "y"], ["r", "z"]]`,
      "search params": `new URLSearchParams("p=7&p=8")`,
      "null": "null",
      "undefined": "undefined",
      "an object with toString": `{ toString: () => "p=9" }`,
      "true": "true",
    },
    asked: {
      "size": "String(made.size)",
      "toString": "made.toString()",
      "get": `String(made.get("p"))`,
      "has": `String(made.has("p")) + made.has("zz")`,
      "for-of": `(() => {\n    const all: string[] = [];\n    for (const [name, value] of made) all.push(name + ":" + value);\n    return all.join();\n  })()`,
      "keys": "[...made.keys()].join()",
      "values": "[...made.values()].join()",
      "entries": "[...made.entries()].join()",
      "three members": `made.size + "|" + made.get("q") + "|" + made.toString()`,
    },
  },
  {
    made: "URL",
    declared: [
      { file: "a-string", type: "string", fits: `"http://a.example/p"` },
      { file: "a-url", type: "URL", fits: `new URL("http://a.example/p")` },
      { file: "a-string-or-a-url", type: "string | URL", fits: `"http://a.example/p"` },
      { file: "a-record", type: "Record<string, string>", fits: `{ p: "1" }`, cast: true },
      { file: "a-number", type: "number", fits: "5", cast: true },
      { file: "unknown", type: "unknown", fits: `"http://a.example/p"`, cast: true },
    ],
    arriving: {
      "a plain address": `"http://h.example/a/b?p=1&q=2"`,
      "an address without a query": `"http://h.example/a/b"`,
      "an address with a fragment": `"http://h.example/a?p=1#f"`,
      "an escaped address": `"http://h.example/a%20b/../c?p=%20"`,
      "an address in capitals": `"HTTP://H.example:80/a"`,
      "a string that is put together": `"http://h.example/" + process.argv.length + "?p=3"`,
      "a string of wide characters": `"http://h.example/\\u4e2d?p=1"`,
      "no address": `"no url"`,
      "a number": "5",
      "a URL": `new URL("http://u.example/x?p=5")`,
      "an object with toString": `{ toString: () => "http://o.example/y?p=6" }`,
      "null": "null",
      "undefined": "undefined",
    },
    asked: {
      "pathname": "made.pathname",
      "search": "made.search",
      "searchParams.get": `String(made.searchParams.get("p"))`,
      "searchParams.has": `String(made.searchParams.has("p"))`,
      "three members": `made.pathname + "|" + made.search + "|" + made.searchParams.get("p")`,
    },
  },
];

// What else the function does with the value, and where the type is written.
const reads = ["", "  const seen = (given as any).length;\n", "  const seen = (given as any).p;\n"];

const written: WrittenProgram[] = [];
for (const { made, declared, arriving, asked } of families) {
  for (const { file, type, fits, cast } of declared) {
    const parts: string[] = [];
    for (const [arrives, value] of Object.entries(arriving)) {
      for (const [question, answer] of Object.entries(asked)) {
        const n = parts.length + 1;
        const read = reads[n % reads.length]!;
        const head =
          n % 2
            ? `function ask${n}(given: ${type}): string {\n`
            : `function ask${n}(handed: any): string {\n  const given: ${type} = handed;\n`;
        const label = JSON.stringify(`${arrives}, ${question}:`);
        parts.push(
          `${head}${read}  const made = new ${made}(given${cast ? " as any" : ""});\n  const answer = ${answer};\n  return answer${read ? ` + "|" + seen` : ""};\n}\n` +
            `const value${n}: any = process.argv.length > 9 ? ${fits} : ${value};\n` +
            `try {\n  let said = "";\n  for (let round = 0; round < 3; round++) said = ask${n}(value${n});\n  console.log(${label}, said);\n} catch (error: any) {\n  console.log(${label}, "throws", error?.constructor?.name);\n}`,
        );
      }
    }
    const first = `// GENERATED by ../../generate/url-objects-made-of-values-that-are-not-what-their-types-say.ts. new ${made}(x) where x is declared as ${type} and is whatever comes through any.\n`;
    const entry = `${made === "URL" ? "a-url" : "search-params"}-made-of-what-is-declared-as-${file}.ts`;
    written.push({ entry, files: { [entry]: first + parts.join("\n\n") + "\n" } });
  }
}

export const programs = (): WrittenProgram[] => written;
