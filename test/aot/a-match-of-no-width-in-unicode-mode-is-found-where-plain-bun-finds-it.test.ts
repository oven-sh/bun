// In unicode mode a lead surrogate and the trail surrogate behind it are one character: no match begins or ends between them, and a search that steps over a match of no width steps over both.
// Which code answers depends on where the pattern's text comes from: a literal and a text that the build works out have their code in the image; a text of the run is run by a program that is
// made at run time. So each pattern is asked in three programs, one for each, and each program's output is compared with what plain Bun prints for the same file.
//
// What it takes to come to the program made at run time by the straight road from compiled code, which once lacked what the long road does:
// - the program holds no literal of the same text and flags: the run would find that one's code. Hence three programs.
// - the build knows at the call that the receiver is a RegExp as it was made: its own constant, handed to nothing else. Hence one object for each method.
// - a function of ordinary size. Hence one function for each pattern.
// - several subjects: the first asking goes the long way round.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { built, slot, spawned } from "./harness/commands";
import { describe, test } from "./supported";

const sources = [
  "\\B", "\\b", "^", "$", "(?<!a)", "(?!a)", "(?<!a)(?!a)", "(?<=a)", "(?=b)", "x|", "(?:)", "x*", "x*?", "a?", "(?:x|)", "()", "\\B|x", "(?:)\\B", "(\\B)", "\\B\\B",
  "(?=\\B)", "(?<=\\B)", "$|\\B", "[ab_]$|\\B", "(?<![a-z])", "(?![a-z])", "(?<![a-z])(?![a-z])", "\\b|\\B", "(?<!a)$", "^(?!a)", "(?<!^)", "(?!$)", "(?<!^)(?!$)", "(?<!a)(?!$)",
  "\\Bb", "a\\B", "(?<!a)b", "b*(?<!a)", "(?:a|\\B)", "(?<x>\\B)", "(?<!\\n)^", "$(?!\\n)", "(?<![ab])\\B", "[^\\s\\S]|\\B", "(?<!.)", "(?!.)", ".\\B", "\\B.", "(?<=.)\\B", "\\B(?=.)",
  "(?<!\\p{L})", "(?!\\p{L})(?<!\\p{L})", "\\P{L}\\B", "(?<!\\u{1F600})", "(?!\\u{1F600})(?<!a)", "(?<!\\ud83d)", "(?!\\ude00)(?<!a)",
]; // prettier-ignore
const flagSets = ["u", "v", "iu", "mu", "gu", "yu", ""];
const subjects = [
  "a\u{1F600}b", "a\u{1F600}\ude00", "\u{1F600}", "\u{1F600}\u{1F600}", "\u{1F600}ab", "ab", "\ud83d", "\ude00a", "a\ud83db", "\u{1F600}\n\u{1F600}", "x\u{1F600}x\u{1F600}", "c\u{1E922}aaaa", "",
  "a\u{1F600}", "aa\u{1F600}\u{1F600}bb", "\ude00\ud83d", "中\u{1F600}中",
]; // prettier-ignore

const needsUnicodeMode = (source: string) => /\\[pP]\{|\\u\{/.test(source);
const patterns = sources.flatMap(source =>
  flagSets.filter(flags => /[uv]/.test(flags) || !needsUnicodeMode(source)).map(flags => ({ source, flags })),
);
// JSON.stringify() writes a lone surrogate as an escape; a pair it leaves as it is, and the files stay ASCII.
const quoted = (text: string) =>
  JSON.stringify(text).replace(/[^\x20-\x7e]/gu, c => `\\u{${c.codePointAt(0)!.toString(16)}}`);

const origins = {
  "a text of the run": ({ source, flags }) => `new RegExp(${quoted(source)} + nothing, ${quoted(flags)})`,
  "a text that the build works out": ({ source, flags }) => `new RegExp(${quoted(source)}, ${quoted(flags)})`,
  "a literal": ({ source, flags }) => `/${source}/${flags}`,
} satisfies Record<string, (pattern: (typeof patterns)[number]) => string>;

function functionThatAsks(index: number, pattern: (typeof patterns)[number], made: string) {
  const isGlobal = pattern.flags.includes("g");
  const moves = isGlobal || pattern.flags.includes("y");
  const asks = [
    'show(RE.exec(subject + nothing)) + "@" + RE.lastIndex',
    '(RE.test(subject + nothing) ? 1 : 0) + "@" + RE.lastIndex',
    isGlobal ? "code((subject + nothing).match(RE))" : "show((subject + nothing).match(RE))",
    "(subject + nothing).search(RE)",
    'code((subject + nothing).replace(RE, "[$&]"))',
    "code((subject + nothing).split(RE))",
    ...(isGlobal
      ? [
          "code([...(subject + nothing).matchAll(RE)].map(each => each.index))",
          'code((subject + nothing).replaceAll(RE, "<$&>"))',
        ]
      : []),
  ];
  return [
    `function ask${index}() {`,
    ...asks.map((_, which) => `const re${which} = ${made};`),
    moves ? `const reAt = ${made};` : "",
    `let line = ${quoted(`/${pattern.source}/${pattern.flags} `)};`,
    "for (const subject of subjects) {",
    ...asks.map(
      (ask, which) =>
        `${moves ? `re${which}.lastIndex = 0; ` : ""}line += ${ask.replaceAll("RE", `re${which}`)} + " ";`,
    ),
    moves
      ? 'for (let at = 0; at <= subject.length; at++) { reAt.lastIndex = at; line += at + ">" + show(reAt.exec(subject + nothing)) + "@" + reAt.lastIndex + " "; }'
      : "",
    'line += "| "; }',
    "console.log(line); }",
    `ask${index}();`,
  ].join("\n");
}

const programOf = (make: (pattern: (typeof patterns)[number]) => string) =>
  [
    "const nothing = String(Date.now()).slice(99);",
    `const subjects = [${subjects.map(quoted).join(", ")}];`,
    'const show = m => (m ? m.index + ":" + JSON.stringify(m[0]) + (m.length > 1 ? "," + JSON.stringify(m[1]) : "") : "null");',
    "const code = text => JSON.stringify(text);",
    ...patterns.map((pattern, index) => functionThatAsks(index, pattern, make(pattern))),
  ].join("\n") + "\n";

describe.concurrent(
  "a pattern that can match nothing, on subjects with surrogate pairs and lone surrogates, answers as in plain Bun",
  () => {
    for (const [origin, make] of Object.entries(origins)) {
      test(
        `where it is ${origin}`,
        () =>
          slot(async () => {
            using dir = tempDir("aot-no-width-in-unicode-mode", { "main.js": programOf(make) });
            const folder = String(dir);
            const plain = await spawned([bunExe(), "main.js"], folder, bunEnv);
            expect({ stderr: plain.stderr, exitCode: plain.exitCode }).toEqual({ stderr: "", exitCode: 0 });
            built(
              await spawned([bunExe(), "build", "--compile", "--aot", "main.js", "--outfile", "out"], folder, bunEnv),
            );
            const compiled = await spawned([join(folder, isWindows ? "out.exe" : "out")], folder, bunEnv);
            expect({ stderr: compiled.stderr, exitCode: compiled.exitCode }).toEqual({ stderr: "", exitCode: 0 });
            const expected = plain.stdout.split("\n");
            const differing = compiled.stdout
              .split("\n")
              .flatMap((line, index) => (line === expected[index] ? [] : [{ compiled: line, plain: expected[index] }]));
            expect(expected.length).toBe(patterns.length + 1);
            expect(differing).toEqual([]);
          }),
        300_000,
      );
    }
  },
);
