// What a file declares at its top is known to the whole file and lives as long as the program. `withTheWholeFileInside` moves the text of a file into the body of a function that runs once, behind
// an await, into a try, a catch, a loop of one turn, a generator behind its first yield or a method: its functions, classes and variables are then local to that. The program prints what it
// printed before.
export const places = [
  "a function",
  "behind an await",
  "a try",
  "a catch",
  "a loop",
  "a generator",
  "a method",
] as const;

// The words in front, the words behind, and whether an await that stood at the top of the file may stand there.
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

// What such a file says holds at its top alone, or hangs on where a line stands.
const isLeftAlone =
  /^export\b|^(declare|namespace|module)\b|\bimport\.meta\b|\bexports\b|^#!|\.stack\b|\bcaptureStackTrace\b|\bawait\s*[=,;)]/m;

export function withTheWholeFileInside(text: string, loader: "ts" | "js", place: (typeof places)[number]): string {
  if (isLeftAlone.test(text)) return text;
  // The comments in front of everything stay there, and so do the imports and the directive.
  const head = /^(?:[ \t]*(?:\/\/[^\n]*)?\n)*/.exec(text)![0];
  const front = [head];
  const rest = text.slice(head.length).replace(/^import\b[^;]*;\n/gm, line => (front.push(line), ""));
  const directive = /^\s*["']use strict["'];?\n/.exec(rest)?.[0] ?? "";
  // An await at the top makes a file a module, and what `this`, `require` and `module` are hangs on that.
  const staysWhatItIs = /^import\b/m.test(text) || !/\b(this|require|module)\b/.test(text);
  // A variable of the words in front hides no name that the file imports.
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
