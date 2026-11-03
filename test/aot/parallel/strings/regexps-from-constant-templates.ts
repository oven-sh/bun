// Regular expressions made once, at their first use, from constant template strings of the module that splice each other several levels deep, the source of another expression, and what a small helper makes of a literal. The longest text has 39,972 characters. They answer what they answer in plain Bun.
// KNOWN templates [A-Za-z_][A-Za-z0-9_]*\(\s*(?:[A-Za-z_][A-Za-z0-9_]*\s*=\s*(?:[0-9]+(?:\.[0-9]+)?|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[A-Za-z_][A-Za-z0-9_]*)(?:\s*,\s*[A-Za-z_][A-Za-z0-9_]*\s*=\s*(?:[0-9]+(?:\.[0-9]+)?|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[A-Za-z_][A-Za-z0-9_]*))*)?\s*\)|[A-Za-z_][A-Za-z0-9_]*\s*=\s*(?:[0-9]+(?:\.[0-9]+)?|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[A-Za-z_][A-Za-z0-9_]*)(?:\s*,\s*[A-Za-z_][A-Za-z0-9_]*\s*=\s*(?:[0-9]+(?:\.[0-9]+)?|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[A-Za-z_][A-Za-z0-9_]*))*
// KNOWN templates [A-Za-z_][A-Za-z0-9_]*\(\s*(?:[A-Za-z_][A-Za-z0-9_]*\s*=\s*(?:[0-9]+(?:\.[0-9]+)?|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[A-Za-z_][A-Za-z0-9_]*)(?:\s*,\s*[A-Za-z_][A-Za-z0-9_]*\s*=\s*(?:[0-9]+(?:\.[0-9]+)?|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[A-Za-z_][A-Za-z0-9_]*))*)?\s*\)
// KNOWN source [A-Za-z_][A-Za-z0-9_]*\(\s*(?:[A-Za-z_][A-Za-z0-9_]*\s*=\s*(?:[0-9]+(?:\.[0-9]+)?|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[A-Za-z_][A-Za-z0-9_]*)(?:\s*,\s*[A-Za-z_][A-Za-z0-9_]*\s*=\s*(?:[0-9]+(?:\.[0-9]+)?|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[A-Za-z_][A-Za-z0-9_]*))*)?\s*\)[ \t]+[A-Za-z_][A-Za-z0-9_]*\(\s*(?:[A-Za-z_][A-Za-z0-9_]*\s*=\s*(?:[0-9]+(?:\.[0-9]+)?|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[A-Za-z_][A-Za-z0-9_]*)(?:\s*,\s*[A-Za-z_][A-Za-z0-9_]*\s*=\s*(?:[0-9]+(?:\.[0-9]+)?|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[A-Za-z_][A-Za-z0-9_]*))*)?\s*\)
// KNOWN source ^[A-Za-z_][A-Za-z0-9_]*\(\s*(?:[A-Za-z_][A-Za-z0-9_]*\s*=\s*(?:[0-9]+(?:\.[0-9]+)?|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[A-Za-z_][A-Za-z0-9_]*)(?:\s*,\s*[A-Za-z_][A-Za-z0-9_]*\s*=\s*(?:[0-9]+(?:\.[0-9]+)?|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[A-Za-z_][A-Za-z0-9_]*))*)?\s*\)[ \t]+[A-Za-z_][A-Za-z0-9_]*\(\s*(?:[A-Za-z_][A-Za-z0-9_]*\s*=\s*(?:[0-9]+(?:\.[0-9]+)?|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[A-Za-z_][A-Za-z0-9_]*)(?:\s*,\s*[A-Za-z_][A-Za-z0-9_]*\s*=\s*(?:[0-9]+(?:\.[0-9]+)?|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[A-Za-z_][A-Za-z0-9_]*))*)?\s*\)$
// KNOWN helper a\.b\(c\)(?:[A-Za-z_][A-Za-z0-9_]*\(\s*(?:[A-Za-z_][A-Za-z0-9_]*\s*=\s*(?:[0-9]+(?:\.[0-9]+)?|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[A-Za-z_][A-Za-z0-9_]*)(?:\s*,\s*[A-Za-z_][A-Za-z0-9_]*\s*=\s*(?:[0-9]+(?:\.[0-9]+)?|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[A-Za-z_][A-Za-z0-9_]*))*)?\s*\))?
// KNOWN helper ^a\.b\(c\)(?:[A-Za-z_][A-Za-z0-9_]*\(\s*(?:[A-Za-z_][A-Za-z0-9_]*\s*=\s*(?:[0-9]+(?:\.[0-9]+)?|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[A-Za-z_][A-Za-z0-9_]*)(?:\s*,\s*[A-Za-z_][A-Za-z0-9_]*\s*=\s*(?:[0-9]+(?:\.[0-9]+)?|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[A-Za-z_][A-Za-z0-9_]*))*)?\s*\))?$
// KNOWN raw (?:\d+\.\d+)?[A-Za-z_][A-Za-z0-9_]*\(\s*(?:[A-Za-z_][A-Za-z0-9_]*\s*=\s*(?:[0-9]+(?:\.[0-9]+)?|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[A-Za-z_][A-Za-z0-9_]*)(?:\s*,\s*[A-Za-z_][A-Za-z0-9_]*\s*=\s*(?:[0-9]+(?:\.[0-9]+)?|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[A-Za-z_][A-Za-z0-9_]*))*)?\s*\)
// KNOWN raw ^(?:\d+\.\d+)?[A-Za-z_][A-Za-z0-9_]*\(\s*(?:[A-Za-z_][A-Za-z0-9_]*\s*=\s*(?:[0-9]+(?:\.[0-9]+)?|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[A-Za-z_][A-Za-z0-9_]*)(?:\s*,\s*[A-Za-z_][A-Za-z0-9_]*\s*=\s*(?:[0-9]+(?:\.[0-9]+)?|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[A-Za-z_][A-Za-z0-9_]*))*)?\s*\)$
function escapeText(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function optional(text: string): string {
  return `(?:${text})?`;
}

const digit = `[0-9]`;
const word = `[A-Za-z_][A-Za-z0-9_]*`;
const number = `${digit}+(?:\\.${digit}+)?`;
const quoted = `"(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*'`;
const value = `(?:${number}|${quoted}|${word})`;
const pair = `${word}\\s*=\\s*${value}`;
const list = `${pair}(?:\\s*,\\s*${pair})*`;
const call = `${word}\\(\\s*(?:${list})?\\s*\\)`;
const space = /[ \t]+/;
const withSource = `${call}${space.source}${call}`;
const withHelper = `${escapeText("a.b(c)")}${optional(call)}`;
const withRaw = `${optional(String.raw`\d+\.\d+`)}${call}`;
const level5 = `(?:${call}|${list}|${pair})`;
const level6 = `(?:${level5};${level5};${level5};${level5})`;
const level7 = `(?:${level6}\\n${level6}\\n${level6}\\n${level6})`;
const level8 = `(?:${level7}|x${level7}|y${level7}|z${level7})`;

type Table = { [name: string]: { all: RegExp; one: RegExp } };
let table: Table | undefined;
function expressions(): Table {
  return (table ??= {
    small: { all: new RegExp(`${call}|${list}`, "g"), one: new RegExp(call) },
    source: { all: new RegExp(withSource, "g"), one: new RegExp(`^${withSource}$`) },
    helper: { all: new RegExp(withHelper, "g"), one: new RegExp(`^${withHelper}$`) },
    raw: { all: new RegExp(withRaw, "g"), one: new RegExp(`^${withRaw}$`) },
    five: { all: new RegExp(level5, "g"), one: new RegExp(`^${level5}$`) },
    six: { all: new RegExp(level6, "g"), one: new RegExp(`^${level6}$`) },
    seven: { all: new RegExp(level7, "g"), one: new RegExp(`^${level7}$`) },
    eight: { all: new RegExp(level8, "g"), one: new RegExp(`^${level8}$`) },
  });
}

const four = (text: string, separator: string) => [text, text, text, text].join(separator);
const lines = four(four("f(a = 1)", ";"), "\n");
const subjects = [`f(a = 1, b = "two") g(c = 3.5)  a.b(c)h() 12.5k(x = y)`, "f(a = 1)", "f() \tg(a = 'b')", "a.b(c)h()", "12.5k(x = y)", four("f(a = 1)", ";"), lines, "1" + lines, lines.slice(0, -1)];
let total = 0;
for (const name in expressions()) {
  const { all, one } = expressions()[name];
  total += all.source.length;
  console.log(name, all.source.length, subjects.map(subject => `${subject.match(all)?.length ?? 0}:${one.test(subject)}`).join(" "));
}
console.log(total);

export {};
