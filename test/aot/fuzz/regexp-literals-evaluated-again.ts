// Every evaluation of a regular expression literal makes a new object whose lastIndex is 0. The compiler may use one object
// for all evaluations where nobody can tell. Each scene evaluates a literal again and again, in a function that is called
// several times or in a loop, and uses it in ways that can tell: a global or sticky search that stops halfway, lastIndex
// read or stored, a property added, the object kept, compared, returned, frozen or handed to a function nobody knows.
import type { Random } from "./random";

const patterns = ["a", "a(b)?", "[ab]+", "\\\\d+", "(?<word>\\\\w+)", "b|$", "^a", "", "a*?", "(a)(b)?\\\\1"].map(
  pattern => pattern || "(?:)",
);
const flags = ["", "g", "g", "y", "y", "gy", "i", "gi", "u", "gu", "d", "gd", "m", "s", "gm"];

/** Statements that use `re` and `text` and push what they see to `out`. */
const uses = [
  "out.push(re.test(text));",
  "out.push(re.test(text), re.test(text));",
  "out.push(re.test(text), re.lastIndex);",
  "out.push(re.lastIndex);",
  "out.push(re.exec(text)?.index);",
  "out.push(re.exec(text)?.[0], re.lastIndex);",
  "re.lastIndex = 2;\n  out.push(re.test(text), re.lastIndex);",
  "out.push(re.lastIndex);\n  re.lastIndex = 3;",
  'out.push(text.replace(re, "-"));',
  'out.push(text.replace(re, "-"), re.lastIndex);',
  "out.push(text.match(re)?.length);",
  "out.push(told(() => [...text.matchAll(re)].length));",
  "out.push(text.split(re).length);",
  "out.push(text.search(re), re.lastIndex);",
  "out.push(re.source + re.flags);",
  "out.push(re.extra);\n  re.extra = call;",
  "out.push(kept.includes(re));\n  kept.push(re);",
  "out.push(kept.at(-1)?.lastIndex);\n  re.test(text);\n  kept.push(re);",
  "out.push(unknown(re, text));",
  "out.push(unknown(re, text), re.lastIndex);",
  'if (re.test(text)) return "found " + re.lastIndex;',
  "if (call === 1) re.test(text);\n  out.push(re.lastIndex);",
  "if (call === 1) Object.freeze(re);\n  out.push(told(() => re.test(text)), Object.isFrozen(re));",
  "if (call === 1) re.exec = () => null;\n  out.push(re.test(text));",
  'if (call === 1) told(() => re.compile("b", "g"));\n  out.push(re.source, re.test(text));',
  "out.push(RegExp(re) === re, new RegExp(re).lastIndex);",
  "while (re.test(text)) {\n    out.push(re.lastIndex);\n    if (out.length > 6 || !re.global) break;\n  }",
  "for (let match; (match = re.exec(text)); ) {\n    out.push(match.index);\n    if (out.length > 2 || !re.global) break;\n  }",
  "out.push(Object.keys(re).join(), Object.getOwnPropertyNames(re).join());",
  "holder.re ??= re;\n  out.push(holder.re === re, holder.re.lastIndex);",
];

const texts = ['"abab"', '"xxabab ab"', '""', '"b"', '"aaa"', '"12 345 6"', 'part("ab") + part("ab")', '"a\\nab"'];

export function generate(random: Random): string {
  const scenes: string[] = [];
  for (let scene = 0, total = random.between(3, 7); scene < total; scene++) {
    const literal = `/${random.pick(patterns)}/${random.pick(flags)}`;
    const body = random.sample(uses, random.between(1, 3)).join("\n  ");
    const text = random.pick(texts);
    const calls = random.pick([3, 4, 4, 300]);
    const shape = random.pick(["function", "function", "loop", "arrow in a list", "default parameter"]);
    const show = `if (call < 4 || call === ${calls - 1}) answers.push(String(answer));`;
    if (shape === "loop") {
      scenes.push(`{
  const answers = [];
  const kept = [];
  const holder = {};
  for (let call = 0; call < ${calls}; call++) {
    const answer = told(() => {
      const text = ${text};
      const out = [];
      const re = ${literal};
      ${body.replaceAll("\n", "\n    ")}
      return out.join();
    });
    ${show}
  }
  console.log("scene ${scene}", answers.join(" | "), kept.length, new Set(kept).size);
}`);
      continue;
    }
    const head =
      shape === "default parameter" ? `function scene${scene}(text, call, kept, holder, re = ${literal}) {\n  const out = [];` : `function scene${scene}(text, call, kept, holder) {\n  const out = [];\n  const re = ${shape === "arrow in a list" ? `[() => ${literal}][0]()` : literal};`; // prettier-ignore
    scenes.push(`${head}
  ${body}
  return out.join();
}
{
  const answers = [];
  const kept = [];
  const holder = {};
  for (let call = 0; call < ${calls}; call++) {
    const answer = told(() => scene${scene}(${text}, call, kept, holder));
    ${show}
  }
  console.log("scene ${scene}", answers.join(" | "), kept.length, new Set(kept).size);
}`);
  }
  return `const part = text => process.argv[9] ?? text;
const ways = [(re, text) => re.test(text), (re, text) => re.lastIndex, (re, text) => ((re.lastIndex = 1), re.exec(text)?.index)];
let turn = 0;
const unknown = (re, text) => ways[turn++ % ways.length](re, text);
function told(ask) {
  try {
    return ask();
  } catch (error) {
    return "threw " + error.name;
  }
}
${scenes.join("\n")}
`;
}
