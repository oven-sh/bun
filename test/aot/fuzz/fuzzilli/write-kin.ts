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

/**
 * The program without three habits that have a build keep so much of the library that nothing is missing any more. Each has hidden a method that was left out of the executable. `undefined` where the program has none of them.
 *
 * A value that nobody knows, a list, a function or a table handed to `console.log()` as it is: the build keeps the printer of values and what the printer may come by. Here every print makes texts of what it is handed.
 * A list read under a key that nobody knows, the usual way of a scene to lose sight of a value: the key may name any method of a list. Here the value goes through a record under such a key.
 * In older builds, a read of `.constructor` off a value that nobody knows.
 */
export function withoutWhatKeepsTheLibrary(text: string, isTypeScript: boolean): string | undefined {
  const makes = `(...all${isTypeScript ? ": any[]" : ""}) => console.log(all.map(one => (Object.is(one, -0) ? "-0" : String(one))).join(" "))`;
  let changed = text.replace(
    /^((?:const|let|var) [\w$]+)(?:: any)? = console\.log;$/gm,
    (_, born) => `${born} = ${makes};`,
  );
  if (/(?<![\w$.])console\.log\(/.test(changed.replaceAll(makes, "")) && !/\bprintTexts\b/.test(changed)) {
    const lines = changed.split("\n");
    let at = 0;
    while (at < lines.length && /^\s*(?:\/\/.*|#!.*|["']use strict["'];?)?$/.test(lines[at])) at++;
    changed = [
      ...lines.slice(0, at),
      `const printTexts = ${makes};`,
      ...lines
        .slice(at)
        .map(line => (line.includes(makes) ? line : line.replace(/(?<![\w$.])console\.log\(/g, "printTexts("))),
    ].join("\n");
  }
  const names = [...new Set([...changed.matchAll(/\bcatch ?\((\w+)\b/g)].map(found => found[1]))].join("|");
  if (names)
    changed = changed.replace(
      new RegExp(
        `((?:\\((?:${names})(?: as (?:any|Error))?\\)|(?<![\\w$.])(?:${names}))(?:\\?\\.|\\.))constructor(?:\\?\\.|\\.)(?=name\\b)`,
        "g",
      ),
      "$1",
    );
  const under = '][JSON.parse("0")]';
  for (let end = changed.indexOf(under); end >= 0; end = changed.indexOf(under, end + 1)) {
    let start = end - 1;
    for (let depth = 0; start >= 0; start--) {
      if ("])}".includes(changed[start])) depth++;
      else if (depth && "[({".includes(changed[start])) depth--;
      else if (changed[start] === "[" || (changed[start] === "," && !depth)) break;
    }
    if (changed[start] !== "[" || /[\w$)\]]/.test(changed.slice(0, start).trimEnd().at(-1) ?? "")) continue;
    changed = `${changed.slice(0, start)}({ a: ${changed.slice(start + 1, end)} }${isTypeScript ? " as any" : ""})[JSON.parse('"a"')]${changed.slice(end + under.length)}`;
  }
  return changed === text ? undefined : changed;
}

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
  // The first turn of a loop is then what first touches whatever the line touches: a module of the library, a file, a variable that is filled late.
  aLineInALoop: (text, pick) => {
    const lines = linesOf(text);
    const at = lines.flatMap((line, index) =>
      isStatement(line) && /^[\w$.]+\(/.test(line) && !/\bawait\b/.test(line) ? [index] : [],
    );
    if (!at.length) return undefined;
    const index = pick(at);
    const turns = pick(["1", "2", "3", 'Number("2")', 'Number("0")']);
    return [
      ...lines.slice(0, index),
      `for (let again = 0; again < ${turns}; again++) { ${lines[index]} }`,
      ...lines.slice(index + 1),
    ].join("\n");
  },
  // A function that the file declares is called at the head of the file too, before anything is filled, with zeros for its numbers: a loop under such a bound runs no turn.
  aCallBeforeAnythingIsFilled: (text, pick) => {
    const lines = linesOf(text);
    const declared = [...text.matchAll(/^function ([\w$]+)\(([^()\n]*)\)/gm)];
    if (!declared.length) return undefined;
    const [, name, parameters] = pick(declared);
    const given = parameters.trim()
      ? parameters.split(",").map(() => pick(["0", "0", 'Number("0")', "null", "undefined"]))
      : [];
    const head = lines.findIndex(line => !/^\s*(?:\/\/|"use strict"|import\b|$)/.test(line));
    if (head < 0) return undefined;
    return [...lines.slice(0, head), `try { ${name}(${given.join(", ")}); } catch {}`, ...lines.slice(head)].join("\n");
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
  // Whoever prints a value uses it, and what is used is compiled otherwise: a print has hidden more than one death of the compiler. Without its prints a program can still stop the build, die or never end.
  nobodyLooksOn: text => {
    const lines = linesOf(text);
    const kept = lines.filter(line => !/^\s*(?:printValue|console\.log)\(.*\);\s*$/.test(line));
    return kept.length < lines.length ? kept.join("\n") : undefined;
  },
  aNumberLooksOn: (text, pick) => {
    const grows = [...text.matchAll(/\b([A-Za-z_$][\w$]*) \+= [^;\n]*? \+ "[;,|.]";/g)].map(found => found[1]);
    if (!grows.length) return undefined;
    const name = pick(grows).replace(/\$/g, "\\$&");
    const born = new RegExp(`\\b(let|var) ${name}(?:: (?:string|any))? = "";`);
    if (!born.test(text)) return undefined;
    return text
      .replace(born, (_, word) => `${word} ${name.replace(/\\/g, "")} = 0;`)
      .replace(
        new RegExp(`\\b${name} \\+= ([^;\\n]*?) \\+ "[;,|.]";`, "g"),
        (_, value) => `${name.replace(/\\/g, "")} += String(${value}).length;`,
      );
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
  "nobodyLooksOn",
  "aNumberLooksOn",
  "aLineTwice",
  "aLineInALoop",
  "aCallBeforeAnythingIsFilled",
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
    const name = pick([
      ...Object.keys(rewrites),
      "nobodyLooksOn",
      "nobodyLooksOn",
      "aNumberLooksOn",
      "aNumberLooksOn",
      "aLineInALoop",
      "aLineInALoop",
      "aCallBeforeAnythingIsFilled",
      "aCallBeforeAnythingIsFilled",
    ]);
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
