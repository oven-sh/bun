// Kin of a program: the same text with one to three small changes, of the kind that a reader makes by hand to see how far a fault reaches: `var` for `let`, a fraction for a whole number,
// null for a text, a loop that runs backward, the whole file inside a function, a member under a computed name, two operands the other way round, a line twice, a line less.
// A change need not keep what the program means. The kin is held against `bun <file>` like any other program, and one that `bun <file>` does not run to its end is dropped.
//
// Each unit of the compiler brings programs that use what it adds. Kin of the programs that came last ask about the edges of what was written last.

type Rewrite = (text: string, pick: <T>(from: readonly T[]) => T) => string | undefined;

/** Replaces one match of `pattern`, drawn among all of them that stand outside comments at the start of a line. */
function atOne(
  text: string,
  pattern: RegExp,
  pick: <T>(from: readonly T[]) => T,
  replace: (match: RegExpExecArray) => string | undefined,
) {
  const matches = [...text.matchAll(pattern)].filter(
    match => !/^\s*(?:\/\/|\*|\/\*)/.test(text.slice(text.lastIndexOf("\n", match.index!) + 1, match.index!)),
  );
  if (!matches.length) return undefined;
  const match = pick(matches) as RegExpExecArray;
  const put = replace(match);
  return put === undefined ? undefined : text.slice(0, match.index) + put + text.slice(match.index! + match[0].length);
}
const isModule = (text: string) => /^\s*(?:import|export)\b|\bawait\b/m.test(text);
const linesOf = (text: string) => text.split("\n");
const isStatement = (line: string) =>
  /;\s*$/.test(line) && !/^\s*(?:\/\/|\*|import\b|export\b|return\b|break\b|continue\b)/.test(line);

const rewrites: Record<string, Rewrite> = {
  anotherKeyword: (text, pick) =>
    atOne(text, /\b(let|var|const)(?= [\w$[{])/g, pick, ([, word]) => (word === "let" ? "var" : "let")),
  anotherNumber: (text, pick) =>
    atOne(text, /(?<![\w.$"'`#-])\d+(?:\.\d+)?(?![\w.$"'`:])/g, pick, ([digits]) =>
      pick([
        `${Number(digits) + 1}`,
        "0",
        "-0",
        `${digits}.5`,
        "2147483647",
        "4294967296",
        "-1",
        "NaN",
        `(${digits})`,
        "1e21",
      ]),
    ),
  anotherKindOutOfAParser: (text, pick) =>
    atOne(text, /JSON\.parse\((["'`])(?:(?!\1).)*\1\)/g, pick, () =>
      pick([
        `JSON.parse('"x"')`,
        `JSON.parse("null")`,
        `JSON.parse("1.5")`,
        `JSON.parse("[]")`,
        `JSON.parse("{}")`,
        `JSON.parse("true")`,
        `JSON.parse("-0")`,
        `JSON.parse("7")`,
        "undefined",
      ]),
    ),
  insideAFunction: (text, pick) =>
    isModule(text)
      ? undefined
      : pick([
          `(function () {\n${text}\n})();\n`,
          `function wholeFile() {\n${text}\n}\nwholeFile();\n`,
          `{\n${text}\n}\n`,
        ]),
  anotherLoop: (text, pick) =>
    atOne(text, /for \((let|var) (\w+) = 0; \2 < ([^;]+); \2\+\+\)/g, pick, ([, word, name, bound]) =>
      pick([
        `for (${word} ${name} = (${bound}) - 1; ${name} >= 0; ${name}--)`,
        `for (const ${name} of Array.from({ length: ${bound} }, (_, at) => at))`,
        `for (${word} ${name} = 0; ${name} < ${bound}; ${name} += 1)`,
        `for (${word} ${name} = 0; ${name} <= (${bound}) - 1; ++${name})`,
        `for (${word === "let" ? "var" : "let"} ${name} = 0; ${name} < ${bound}; ${name}++)`,
        `for (${word} ${name} = 0; ${name} != ${bound}; ${name}++)`,
      ]),
    ),
  anotherWalk: (text, pick) =>
    atOne(text, /for \(const (\w+) of (\w+)\)/g, pick, ([, name, list]) =>
      pick([
        `for (const ${name} of ${list}.values())`,
        `for (const ${name} of [...${list}])`,
        `for (let ${name} of ${list})`,
        `for (const ${name} of ${list}[Symbol.iterator]())`,
      ]),
    ),
  anotherOperator: (text, pick) =>
    atOne(text, / (===|!==|==|!=|<=|>=|<|>|\|\||&&|\?\?) /g, pick, ([, operator]) => {
      const others: Record<string, string[]> = { "===": ["=="], "!==": ["!="], "==": ["==="], "!=": ["!=="], "<": ["<=", ">"], "<=": ["<"], ">": [">=", "<"], ">=": [">"], "||": ["??", "&&"], "&&": ["||"], "??": ["||"] }; // prettier-ignore
      return ` ${pick(others[operator])} `;
    }),
  operandsTheOtherWayRound: (text, pick) =>
    atOne(
      text,
      /([\w$.]+|`[^`\n]*`|"[^"\n]*") (\+|\*|-|&|\|) ([\w$.]+|`[^`\n]*`|"[^"\n]*")/g,
      pick,
      ([, left, operator, right]) => `${right} ${operator} ${left}`,
    ),
  aMemberUnderAText: (text, pick) =>
    atOne(text, /(?<=[\w$)\]])\.([A-Za-z_$][\w$]*)\b(?!\s*[:=](?!=))/g, pick, ([, name]) =>
      pick([`[${JSON.stringify(name)}]`, `[[${JSON.stringify(name)}].join("")]`, `?.${name}`]),
    ),
  throughUnseenCode: (text, pick) =>
    atOne(text, /(?<=[(,] ?)([A-Za-z_$][\w$]*)(?=[,)])/g, pick, ([name]) => `[${name}][JSON.parse("0")]`),
  aTextAnotherWay: (text, pick) =>
    atOne(text, /`\$\{([\w$.]+)\}`|String\(([\w$.]+)\)/g, pick, ([, inTemplate, inString]) => {
      const value = inTemplate ?? inString;
      return pick([
        `String(${value})`,
        `(${value} + "")`,
        `\`\${${value}}\``,
        `${value}.toString()`,
        `("" + ${value})`,
      ]);
    }),
  anOperandAsAText: (text, pick) =>
    atOne(
      text,
      /(?<=[=(+] )([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)(?= \+ )|(?<= \+ )([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)(?=[ ;)])/g,
      pick,
      ([value]) => pick([`\`\${${value}}\``, `\`\${${value}}\``, `String(${value})`, `(${value} + "")`]),
    ),
  aPartLess: (text, pick) => atOne(text, / \+ (?:"[^"\n]*"|'[^'\n]*'|[\w$.]+)(?= \+ )/g, pick, () => ""),
  aTemplateTakenApart: (text, pick) => atOne(text, /(?<=`[^`\n]*\$\{[^}`\n]*\})(?=[^`\n]*`)/g, pick, () => "` + `"),
  anExpressionFromElsewhere: (text, pick) => {
    const found = [
      ...text.matchAll(
        /[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+|`[^`\n]*`|"[^"\n]*"|(?<![\w.$])\d+(?:\.\d+)?(?![\w.$])/g,
      ),
    ].map(match => match[0]);
    if (found.length < 2) return undefined;
    return atOne(
      text,
      /(?<= (?:\+|-|\*|===|<|=) )(?:[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*|"[^"\n]*"|\d+)(?=[ ;),])/g,
      pick,
      () => pick(found),
    );
  },
  anotherBound: (text, pick) =>
    atOne(text, /(?<=< )(\d+)(?=;)/g, pick, ([digits]) =>
      Number(digits) > 20 ? pick(["1", "2", "3"]) : pick(["100", "300", "2000"]),
    ),
  aLineTwice: (text, pick) => {
    const lines = linesOf(text);
    const at = lines.flatMap((line, index) =>
      isStatement(line) && !/^\s*(?:let|const|class|function)\b/.test(line) ? [index] : [],
    );
    if (!at.length) return undefined;
    const index = pick(at);
    return [...lines.slice(0, index + 1), lines[index], ...lines.slice(index + 1)].join("\n");
  },
  aLineLess: (text, pick) => {
    const lines = linesOf(text);
    const at = lines.flatMap((line, index) =>
      isStatement(line) && !/^\s*(?:let|const|var|class|function)\b/.test(line) ? [index] : [],
    );
    if (!at.length) return undefined;
    const index = pick(at);
    return [...lines.slice(0, index), ...lines.slice(index + 1)].join("\n");
  },
  twoLinesTheOtherWayRound: (text, pick) => {
    const lines = linesOf(text);
    const at = lines.flatMap((line, index) =>
      isStatement(line) && isStatement(lines[index + 1] ?? "") ? [index] : [],
    );
    if (!at.length) return undefined;
    const index = pick(at);
    return [...lines.slice(0, index), lines[index + 1], lines[index], ...lines.slice(index + 2)].join("\n");
  },
  aCollectionBetween: (text, pick) => {
    const lines = linesOf(text);
    const at = lines.flatMap((line, index) => (isStatement(line) ? [index] : []));
    if (!at.length) return undefined;
    const index = pick(at);
    return [...lines.slice(0, index + 1), "Bun.gc(true);", ...lines.slice(index + 1)].join("\n");
  },
  aWiderType: (text, pick) =>
    atOne(text, /: (number|string|boolean|[A-Z]\w*(?:\[\])?)(?=[,)=; ])/g, pick, () =>
      pick([": any", ": unknown", ": any"]),
    ),
  anAsyncFunction: (text, pick) =>
    atOne(text, /(?<!async )\bfunction (\w+)\(/g, pick, ([, name]) =>
      pick([`async function ${name}(`, `function* ${name}(`]),
    ),
  aWaitBetween: (text, pick) => {
    if (!/\basync\b/.test(text)) return undefined;
    return atOne(text, /(?<=async [^{\n]*\{[^\n]*\n)(\s*)/g, pick, ([spaces]) => `${spaces}await null;\n${spaces}`);
  },
};

/** The lines round `at`, alone, so that a second change falls beside the first: faults lie where two small things meet. */
function near(text: string, at: number, rewrite: Rewrite, pick: <T>(from: readonly T[]) => T) {
  const lines = linesOf(text);
  const [from, to] = [Math.max(0, at - 1), Math.min(lines.length, at + 2)];
  const changed = rewrite(lines.slice(from, to).join("\n"), pick);
  return changed === undefined ? undefined : [...lines.slice(0, from), changed, ...lines.slice(to)].join("\n");
}
const whole = new Set([
  "insideAFunction",
  "aLineTwice",
  "aLineLess",
  "twoLinesTheOtherWayRound",
  "aCollectionBetween",
  "anExpressionFromElsewhere",
]);

export function writeKin(text: string, random: () => number): { text: string; changes: string[] } {
  const pick = <T>(from: readonly T[]) => from[Math.floor(random() * from.length)];
  const changes: string[] = [];
  let at = -1;
  for (let wanted = pick([1, 1, 2, 2, 3]), tries = 0; changes.length < wanted && tries < 24; tries++) {
    const name = pick(Object.keys(rewrites));
    const changed = at >= 0 && !whole.has(name) ? near(text, at, rewrites[name], pick) : rewrites[name](text, pick);
    if (changed === undefined || changed === text) continue;
    if (at < 0) {
      const [before, after] = [linesOf(text), linesOf(changed)];
      at = before.findIndex((line, index) => line !== after[index]);
    }
    text = changed;
    changes.push(name);
  }
  return { text, changes };
}
