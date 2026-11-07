// Top-level declarations are visible to the whole file and live as long as the program. `wrapFileInFunction` moves a
// file's text into the body of a function that runs once, after an await, into a try, a catch, a one-iteration loop, or
// a generator. The output stays the same.
export const places = [
  "a function",
  "behind an await",
  "a try",
  "a catch",
  "a loop",
  "a generator",
  "a method",
] as const;

// The prefix, the suffix, and whether a top-level await may go there.
const around: Record<(typeof places)[number], readonly (readonly [string, string, boolean])[]> = {
  "a function": [
    ["(() => {\n", "\n})();\n", false],
    ["await (async () => {\n", "\n})();\n", true],
  ],
  "behind an await": [
    ["await (async () => {\nawait 0;\n", "\n})();\n", true],
    ["(async () => {\nawait 0;\n", "\n})();\n", true],
  ],
  "a try": [["try {\n", "\n} finally {\n}\n", true]],
  "a catch": [["try {\nthrow 0;\n} catch {\n", "\n}\n", true]],
  "a loop": [["for (let turn = 0; turn < (Date.now() < 99 ? 2 : 1); turn++) {\n", "\n}\n", true]],
  "a generator": [
    ["for (const step of (function* () {\nyield 0;\n", "\n})());\n", false],
    ["for await (const step of (async function* () {\nyield 0;\n", "\n})());\n", true],
  ],
  "a method": [
    ["new (class {\nrun() {\n", "\n}\n})().run();\n", false],
    ["await new (class {\nasync run() {\n", "\n}\n})().run();\n", true],
  ],
};

// What such a file does only works at the top level, or depends on line positions.
const isLeftAlone =
  /^export\b|^(declare|namespace|module)\b|\bimport\.meta\b|\bexports\b|^#!|\.stack\b|\bcaptureStackTrace\b|\bawait\s*[=,;)]/m;

export function wrapFileInFunction(text: string, loader: "ts" | "js", place: (typeof places)[number]): string {
  if (isLeftAlone.test(text)) return text;
  // Leading comments stay in place, and so do the imports and the directive.
  const head = /^(?:[ \t]*(?:\/\/[^\n]*)?\n)*/.exec(text)![0];
  const front = [head];
  const rest = text.slice(head.length).replace(/^import\b[^;]*;\n/gm, line => (front.push(line), ""));
  const directive = /^\s*["']use strict["'];?\n/.exec(rest)?.[0] ?? "";
  // A top-level await makes a file a module, and `this`, `require` and `module` depend on that.
  const staysWhatItIs = /^import\b/m.test(text) || !/\b(this|require|module)\b/.test(text);
  // A variable in the prefix must not shadow a name that the file imports.
  const imported = front.join("");
  const free = (name: string) => {
    while (imported.includes(name)) name += "_";
    return name;
  };
  for (const [words, close, holdsAnAwait] of around[place]) {
    const open = words.replace(/\b(?:step|turn)\b/g, free);
    if (/^(for )?await /.test(open) && !staysWhatItIs) continue;
    if (!holdsAnAwait && /\bawait\b/.test(text)) continue;
    const changed = front.join("") + directive + open + rest.slice(directive.length) + close;
    try {
      new Bun.Transpiler({ loader }).transformSync(changed);
      return changed;
    } catch {}
  }
  return text;
}
