// `switch` statements with clauses of every kind, asked about values of every kind.
//
//   clauses     whole numbers close together and far apart, negative and large ones, fractions, `0` and `-0`, `NaN`, texts of one letter, long texts, texts that begin alike, texts that look like numbers,
//               booleans, `null`, `undefined`, big integers, symbols, objects, members of enums, constants, expressions that tell when they run; the same clause twice; from two clauses to three hundred
//   default     first, in the middle, last, missing
//   bodies      `break`, `return`, falling through, empty clauses that share a body, `continue` of a loop around, declarations that a later clause reads, functions declared in a clause
//   asked of    a parameter with and without a written type, `typeof`, a member, a length, a remainder, `| 0`, `true` with tests as clauses, an expression that tells when it runs
//   values      all of the above and their neighbors, boxed numbers and texts, objects with `valueOf`
import type { Random } from "./random";

const head = `const lines: string[] = [];
function show(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "symbol") return String(value);
  if (typeof value === "function") return "function";
  if (value !== null && typeof value === "object") return "object " + Object.prototype.toString.call(value);
  return Object.is(value, -0) ? "-0" : String(value);
}
function note(...parts: unknown[]): void {
  lines.push(parts.map(part => (typeof part === "string" ? part : show(part))).join(" "));
}
function tell<T>(label: string, value: T): T {
  note("runs", label);
  return value;
}
const mark = Symbol("mark");
const thing = { name: "thing" };
const ONE = 1;
const TEXT = "constant";
enum Level {
  Low,
  Middle,
  High = 10,
}
enum Word {
  A = "a",
  B = "bee",
}
const numbers: number[] = [0, -0, 1, 2, 3, 4, 5, 7, 9, 10, 11, 31, 32, 33, 63, 64, 100, 255, 256, 299, 300, 1000, 65536, -1, -2, -100, 1.5, 0.5, -1.5, 2 ** 31, 2 ** 31 - 1, -(2 ** 31), 2 ** 32, 2 ** 32 + 1, 2 ** 53, NaN, Infinity, -Infinity, 1e21];
const texts: string[] = ["", "a", "b", "c", "z", "A", "aa", "ab", "abc", "abd", "bee", "1", "01", "1.0", "-0", "0", "10", "constant", "a long text that goes on", "a long text that goes of", "undefined", "null", "true", "NaN", "é", "\\u{1F600}", "key7", "key12", "key299"];
const others: unknown[] = [true, false, null, undefined, 1n, 0n, 10n, mark, Symbol("mark"), thing, { name: "thing" }, [], [1], () => 1, new Number(1), new String("a"), { valueOf: () => 1 }, { toString: () => "a" }];
`;

/** The answer of the language where plain Bun has another: a line that starts with the key ends with the value. */
export const written = { "a function that a later clause declares is ": "there" };

export function generate(random: Random, hasWhatIsWritten = false): string {
  let count = 0;
  const rows: string[] = [];
  for (let id = 0, scenes = random.between(3, 6); id < scenes; id++) {
    const family = random.weighted([
      [4, "numbers"],
      [3, "texts"],
      [3, "mixed"],
      [1, "enum"],
      [1, "typeof"],
      [1, "true"],
    ] as const);
    const size = random.weighted([
      [5, random.between(2, 8)],
      [2, random.between(9, 40)],
      [1, random.between(41, 300)],
    ]);
    const start = random.pick([0, 0, 1, -3, 30, 250, 65530, 2 ** 31 - 4]);
    const stride = random.pick([1, 1, 1, 2, 7, 1000]);
    const label = (at: number): string => {
      const number = () =>
        random.weighted([
          [8, String(start + at * stride)],
          [
            1,
            random.pick([
              "-0",
              "0",
              "1.5",
              "NaN",
              "-1",
              "2 ** 31",
              "2 ** 32 + 1",
              "1e21",
              "Infinity",
              "ONE",
              "ONE + 1",
              "0.5 + 0.5",
              "Level.High",
              "~0",
              "1_000",
              "0x10",
            ]),
          ],
        ]);
      const text = () =>
        random.weighted([
          [5, `"key${at}"`],
          [
            3,
            random.pick([
              '"a"',
              '"b"',
              '"c"',
              '""',
              '"aa"',
              '"ab"',
              '"abc"',
              '"abd"',
              '"1"',
              '"0"',
              '"a long text that goes on"',
              '"a long text that goes of"',
              '"é"',
              '"\\u{1F600}"',
              "TEXT",
              "`a`",
              '"a" + "b"',
              "Word.B",
              "`1${0}`",
            ]),
          ],
        ]);
      if (family === "numbers") return number();
      if (family === "texts") return text();
      if (family === "enum") return random.pick(["Level.Low", "Level.Middle", "Level.High", "Word.A", "Word.B"]);
      if (family === "typeof")
        return random.pick([
          '"number"',
          '"string"',
          '"object"',
          '"undefined"',
          '"boolean"',
          '"bigint"',
          '"symbol"',
          '"function"',
          '"nothing"',
        ]);
      if (family === "true")
        return random.pick([
          "given === 1",
          'typeof given === "string"',
          "given > 5",
          "given == null",
          "!given",
          "given === given",
          "Array.isArray(given)",
          "true",
          "false",
          "1 as any",
        ]);
      return random.weighted([
        [3, number()],
        [3, text()],
        [
          4,
          random.pick(["true", "false", "null", "undefined", "1n", "10n", "mark", "thing", "void 0", "given", "NaN"]),
        ],
        [1, `tell("clause ${count++}", ${random.pick(["1", '"a"', "null", "thing"])})`],
      ]);
    };
    const type =
      family === "numbers"
        ? random.pick(["number", "number", "any", "unknown"])
        : family === "texts"
          ? random.pick(["string", "string", "any", "unknown"])
          : "any";
    const asked =
      family === "typeof"
        ? "typeof given"
        : family === "true"
          ? "true"
          : type === "number"
            ? random.pick([
                "given",
                "given",
                "given",
                "given | 0",
                "given % 4",
                "given + 1",
                "-given",
                "Math.floor(given)",
                `tell("what is asked ${count++}", given)`,
              ])
            : type === "string"
              ? random.pick([
                  "given",
                  "given",
                  "given",
                  "given.length",
                  "given[0]",
                  'given + ""',
                  "given.charCodeAt(0)",
                  "given.slice(0, 2)",
                  `tell("what is asked ${count++}", given)`,
                ])
              : random.pick(["given", "given", "given", "(given as any)?.name", "(given as any)?.length"]);
    const clauses: string[] = [];
    const defaultAt = random.pick([-1, 0, Math.floor(size / 2), size]);
    const declares = random.chance(0.2);
    for (let at = 0; at <= size; at++) {
      if (at === defaultAt)
        clauses.push(`default:\nseen.push("default");\n${random.pick(["break;", "", `return "from default";`])}`);
      if (at === size) break;
      const body = random.weighted([
        [4, `seen.push(${at});\nbreak;`],
        [2, `return "clause ${at}";`],
        [2, `seen.push(${at});`],
        [2, ""],
        [1, `seen.push(${at});\nif (turn === 0) continue;\nbreak;`],
        [
          declares ? 2 : 0,
          at === 0 ? `let kept = ${at};\nseen.push(kept);` : `// @ts-ignore\nseen.push(typeof kept);\nbreak;`,
        ],
        [declares ? 1 : 0, at === 0 ? `seen.push(0);` : `kept = ${at};\nseen.push(kept);\nbreak;`],
      ]);
      clauses.push(`case ${label(at)}:\n${body}`);
    }
    if (declares) {
      if (!clauses.some(clause => clause.includes("let kept"))) clauses.unshift(`case "never" as any:\nlet kept = -1;`);
    }
    rows.push(
      `function choose${id}(given: ${type}) {\nconst seen: unknown[] = [];\nfor (let turn = 0; turn < 2; turn++) {\n// @ts-ignore\nswitch (${asked}) {\n${clauses.map(clause => (clause.startsWith("case") ? `// @ts-ignore\n${clause}` : clause)).join("\n")}\n}\nseen.push("behind");\n}\nreturn seen.join();\n}`,
      `for (const given of ${type === "number" ? "numbers" : type === "string" ? "texts" : "[...numbers, ...texts, ...others]"}) {\ntry {\nnote("choose${id}", given, "=", choose${id}(given${type === "any" || type === "unknown" ? "" : ""}));\n} catch (error) {\nnote("choose${id}", given, "THROWS", (error as Error).constructor.name);\n}\n}`,
    );
  }
  if (hasWhatIsWritten)
    for (let left = random.between(1, 3); left > 0; left--)
      rows.push(
        `try {\nswitch (${random.pick(["1", '"a"', "ONE"])} as any) {\n${random.pick(["", "default:\n", "case 0:\n"])}case ${random.pick(["1", "ONE"])}:\ncase "a":\nnote("a function that a later clause declares is", ${random.pick(['typeof helper === "function"', 'helper() === "called"'])} ? "there" : "not there");\nbreak;\ncase 2:\nfunction helper() {\nreturn "called";\n}\n}\n} catch (error) {\nnote("a function that a later clause declares is", "missing:", (error as Error).constructor.name);\n}`,
      );
  return `${head}${rows.join("\n")}\nconsole.log(lines.join("\\n"));\nexport {};\n`;
}
