// A compiler can turn a regular expression into machine code at build time: a literal, a constant text, and a text that it can work out,
// such as the members of a table that a loop goes through. A text that only the run knows takes another road. Each road has code of its
// own for subjects stored with one byte a character and with two, and shortcuts that depend on what the pattern can consume.
// A program here takes all its patterns from one origin, because a literal with the same text would lend its code to the others. Small
// patterns (a run, a group, a reference, an assertion, a match of no width) meet subjects with wide characters, surrogate pairs and their
// halves, letters that are equal only without regard to case, line ends, and plain letters that happen to be stored with two bytes.
// Every pattern object serves one method alone and is asked about every subject, so it is asked more than once.
import type { Random } from "./random";

const narrow = ["a", "b", "k", "s", "_", ".", "[ab]", "[^a]", "[a-c]", "\\w", "\\W", "\\d", "\\s", "\\S", "\\xe5", "\\xb5", "\\xff", "[^\\s\\S]"];
const wide = ["\\u2603", "\\u212a", "\\u017f", "[\\u2500-\\u2603]", "\\ud83d", "\\ude00", "\\ud83d\\ude00", "[^\\u2603]", "\\u2028"];
const inUnicodeMode = ["\\u{1F600}", "[\\u{1F600}-\\u{1F64F}]", "[^\\u{1F600}]", "\\u{10400}", "\\u{10428}", "\\p{L}", "\\P{L}", "\\p{Lu}", "\\p{Emoji_Presentation}"];
const flagSets = ["", "", "i", "s", "m", "g", "y", "gi", "d"];
const flagSetsInUnicodeMode = ["u", "u", "v", "iu", "iv", "su", "mu", "du", "gu", "yu", "giu", "gv"];
const texts = [
  "",
  "a",
  "ab",
  "aab",
  "ba",
  "k",
  "K",
  "s",
  "S",
  "_",
  " ",
  "a b",
  "a\nb",
  "K",
  "ſ",
  "\xe5",
  "\xc5",
  "\xb5",
  "Μ",
  "μ",
  "\xff",
  "Ÿ",
  "☃",
  "a☃b",
  "☃☃",
  "a b",
  "\u{1F600}",
  "a\u{1F600}b",
  "\u{1F600}\u{1F600}",
  "\u{1F600}a",
  "aa\u{1F600}",
  "\ud83d",
  "\ude00",
  "\ude00\ud83d",
  "a\ud83d",
  "\ud83da",
  "\ud83d😀",
  "\u{10400}",
  "\u{10428}",
  "\u{10400}\u{10428}",
];

/** A string literal in plain ASCII. */
const quoted = (text: string) => JSON.stringify(text).replace(/[^\x20-\x7e]/g, unit => "\\u" + unit.charCodeAt(0).toString(16).padStart(4, "0"));

export function generate(random: Random, typed: boolean): string {
  const as = (type: string) => (typed ? `: ${type}` : "");
  const origin = random.pick(["a literal", "a constant", "a table", "a table", "a table in a frame", "joined parts", "a text of the run", "a text of the run"] as const);

  const patternFor = (unicode: boolean): string => {
    const atom = () => random.pick(random.chance(0.45) ? narrow : unicode && random.chance(0.6) ? inUnicodeMode : wide);
    const noWidth = () => {
      const x = atom();
      return random.pick(["\\b", "\\B", "\\B", "^", "$", "(?:)", `(?=${x})`, `(?!${x})`, `(?<=${x})`, `(?<!${x})`, "(?!.)", "(?<!^)", "(?<=.)"]);
    };
    const item = (): string => {
      const x = random.chance(0.25) ? noWidth() : atom();
      const y = atom();
      return random.pick([
        x,
        x,
        `${y}*`,
        `${y}+`,
        `${y}?`,
        `${y}*?`,
        `${y}+?`,
        `${y}{2}`,
        `${y}{1,2}`,
        `(${x})`,
        `(?:${x}|${y})`,
        `(?<n>${x})`,
        `(${y})\\1`,
        `(${y}+)\\1`,
        `(?<n>${y})\\k<n>`,
        `(?=(${y}*))\\1`,
        `(?=(${y}))\\1`,
        `(?<=(${y}))\\1?`,
        `\\1(${y})`,
        `(?:${x}|${y})+`,
        `(${x}|${y})*`,
        `${x}|${y}`,
      ]);
    };
    for (;;) {
      const items = Array.from({ length: random.between(1, 3) }, item);
      // A name stands for one group.
      if (items.filter(each => each.includes("(?<n>")).length > 1) continue;
      const inside = items.join("");
      return random.weighted([
        [5, inside],
        [2, `^${inside}$`],
        [1, `^(?:${inside})$`],
        [1, `^${inside}`],
        [1, `${inside}$`],
      ]);
    }
  };

  /** A pattern and flags that this Bun accepts. */
  const drawn = (flags: string): string => {
    for (;;) {
      const source = patternFor(/[uv]/.test(flags)) || "(?:)";
      try {
        new RegExp(source, flags);
        return source;
      } catch {}
    }
  };

  const subjects = random.sample(texts, random.between(8, 13)).map(text =>
    random.weighted([
      [3, quoted(text)],
      [3, `${quoted(text)} + nothing`],
      // Plain letters cut out of a text with a wide character keep two bytes a character.
      [2, `(${quoted("☃" + text)} + nothing).slice(1)`],
    ]),
  );

  /** What is asked of one pattern object about one subject. */
  const questions = (flags: string) => {
    const isGlobal = flags.includes("g");
    const all = [
      'show(RE.exec(subject)) + "@" + RE.lastIndex',
      'show(RE.exec(subject)) + "@" + RE.lastIndex',
      '(RE.test(subject) ? 1 : 0) + "@" + RE.lastIndex',
      "show(subject.match(RE))",
      "show(subject.match(RE))",
      "subject.search(RE)",
      'code(subject.replace(RE, "[$&]"))',
      'code(subject.replace(RE, "<$1>"))',
      'code(subject.replace(RE, (all' + as("string") + ') => "(" + all.length + ")"))',
      'subject.split(RE).map(code).join("|")',
      'subject.split(RE, 3).map(code).join("|")',
      ...(isGlobal
        ? ['[...subject.matchAll(RE)].map(each => each.index + ":" + code(each[0])).join()', 'code(subject.replaceAll(RE, "<$&>"))']
        : []),
    ];
    return random.sample(all, random.between(2, 4));
  };

  /** A block that makes one object for each question by `made` and asks it about every subject. */
  const asks = (label: string, flags: string, made: string) => {
    const asked = questions(flags);
    const moves = /[gy]/.test(flags) && random.chance(0.6);
    return `let line = "";
  ${asked.map((_, at) => `const r${at} = ${made};`).join("\n  ")}${moves ? `\n  const mover = ${made};` : ""}
  for (const subject of subjects) {
    ${asked.map((question, at) => `line += ${question.replaceAll("RE", `r${at}`)} + " ";`).join("\n    ")}${
      moves
        ? '\n    for (let at = 0; at <= subject.length; at++) { mover.lastIndex = at; line += at + ">" + show(mover.exec(subject)) + "@" + mover.lastIndex + " "; }'
        : ""
    }
  }
  console.log(${label}, line);`;
  };

  const someFlags = () => random.pick(random.chance(0.65) ? flagSetsInUnicodeMode : flagSets);
  const blocks: string[] = [];
  if (origin === "a table" || origin === "a table in a frame") {
    for (let table = 0, tables = random.between(2, 3); table < tables; table++) {
      const flags = someFlags();
      const [open, close] = origin === "a table" ? ["", ""] : random.pick([["^", "$"], ["^(?:", ")$"], ["(?:", ")"], ["", "$"], ["(", ")"]]);
      const members: string[] = [];
      while (members.length < 4) {
        const source = drawn(flags);
        try {
          new RegExp(open + source + close, flags);
          members.push(source);
        } catch {}
      }
      const text = origin === "a table" ? "text" : random.pick([`${quoted(open)} + text + ${quoted(close)}`, "`" + open.replaceAll("\\", "\\\\") + "${text}" + close.replaceAll("\\", "\\\\") + "`"]);
      blocks.push(`for (const text of [${members.map(quoted).join(", ")}]) {
  ${asks(`"${table}", code(text)`, flags, `new RegExp(${text}, ${quoted(flags)})`)}
}`);
    }
  } else {
    for (let number = 0, total = random.between(6, 10); number < total; number++) {
      const flags = someFlags();
      const source = drawn(flags);
      let before = "";
      let made: string;
      if (origin === "a literal") made = `/${source}/${flags}`;
      else if (origin === "a constant") made = `new RegExp(${quoted(source)}, ${quoted(flags)})`;
      else if (origin === "a text of the run") made = `new RegExp(${quoted(source)} + nothing, ${quoted(flags)})`;
      else {
        // The second part is appended always, never, or behind the place where the parts are joined.
        let second = drawn(flags);
        for (;;) {
          try {
            new RegExp(`${source}|${second}`, flags);
            break;
          } catch {
            second = drawn(flags);
          }
        }
        const way = random.below(4);
        before =
          `const parts = [${quoted(source)}];\n  ` +
          [
            `parts.push(${quoted(second)});\n  const joined = parts.join("|");`,
            `if (nothing === "") parts.push(${quoted(second)});\n  const joined = parts.join("|");`,
            `if (nothing !== "") parts.push(${quoted(second)});\n  const joined = parts.join("|");`,
            `const joined = parts.join("|");\n  parts.push(${quoted(second)});`,
          ][way] +
          "\n  ";
        made = `new RegExp(joined, ${quoted(flags)})`;
      }
      blocks.push(`{
  ${before}${asks(`"${number}"`, flags, made)}
}`);
    }
  }

  return `const nothing = String(Date.now()).slice(99);
function code(text${as("string | undefined")})${as("string")} {
  if (text === undefined) return "-";
  let out = "";
  for (let at = 0; at < text.length; at++) {
    const unit = text.charCodeAt(at);
    out += unit > 32 && unit < 127 ? text[at] : "\\\\" + unit.toString(16);
  }
  return out;
}
function show(found${as("RegExpMatchArray | null")})${as("string")} {
  if (found === null) return "null";
  const parts = Array.from(found, code).join("|");
  if (found.index === undefined) return "[" + parts + "]";
  const names = found.groups ? Object.keys(found.groups).map(name => name + "=" + code(found.groups${typed ? "!" : ""}[name])).join() : "";
  const places = found.indices ? found.indices.map(pair => (pair ? pair.join("-") : "-")).join() : "";
  return found.index + ":" + parts + names + places;
}
const subjects${as("string[]")} = [${subjects.join(", ")}];
${blocks.join("\n")}
${typed ? "export {};\n" : ""}`;
}
