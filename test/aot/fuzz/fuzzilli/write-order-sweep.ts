// Every order in which a file fills what a loop reads, written out in full and not drawn.
// A function with a loop reaches, by some road, a function that reads something of the file which is declared further down. The file calls the first function before that declaration has run, with a loop
// that runs no turn or with one that runs, and again behind it. A compiler that reads what does not change in front of a loop reads it there in the first call too, where nothing is filled yet.
// At the end it all stands inside a function that is called twice: what the loop's callee reads is a variable of one call.
// In the second half what fills it stands in the loop itself: the first turn is what loads the file, or the module of the library, whose constant the turn goes on to read.
//
//   bun write-order-sweep.ts <folder> [from] [count]      writes the programs number <from> .. <from> + <count> - 1, one file each; other files of a program follow behind `// @filename:` lines.
//   bun write-order-sweep.ts count                         prints how many there are.
//   bun write-order-sweep.ts named <pattern> <folder>      writes the programs whose names the pattern finds.
import { mkdirSync, writeFileSync } from "node:fs";

type Program = { name: string; extension: string; text: string };

/** What is declared further down, and how it is read. */
const holders: [string, string, string][] = [
  ["a-record", 'const held = { width: Number("5") };', "held.width"],
  ["a-number", 'const held = Number("5");', "held"],
  ["a-list", 'const held = [Number("5")];', "held[0]"],
  ["a-variable", 'let held = { width: Number("5") };', "held.width"],
  ["a-class", 'class Held { static width = Number("5"); }', "Held.width"],
  ["a-function", 'const held = () => Number("5");', "held()"],
];
/** How the loop reaches the reader: what stands in front, the parameter, the call, what is laid behind the declaration, what the first and the second call hand over. */
const roads: [string, string, string, string, string, string, string][] = [
  ["by-its-name", "", "", "read(turn)", "", "", ""],
  ["through-a-parameter", "", ", record", "record.read(turn)", "", ", null", ", { read }"],
  ["through-a-function-handed-over", "", ", reader", "reader(turn)", "", ", undefined", ", read"],
  ["through-a-variable-filled-later", "let reader;", "", "reader(turn)", "reader = read;", "", ""],
  ["through-a-record-declared-later", "", "", "table.read(turn)", "const table = { read };", "", ""],
  ["through-a-list-filled-later", "const readers = [];", "", "readers[0](turn)", "readers.push(read);", "", ""],
  ["through-a-bound-function", "let reader;", "", "reader(turn)", "reader = read.bind(null);", "", ""],
];
const loops: [string, (turn: string) => string][] = [
  ["counted", turn => `for (let turn = 0; turn < turns; turn++) { ${turn} }`],
  ["while", turn => `let turn = -1; while (++turn < turns) { ${turn} }`],
  ["over-a-list", turn => `for (const turn of Array.from({ length: turns }, (_, at) => at)) { ${turn} }`],
  [
    "a-loop-in-a-loop",
    turn => `for (let outer = 0; outer < turns; outer++) for (let turn = 0; turn < turns; turn++) { ${turn} }`,
  ],
  ["no-loop", turn => `if (turns > 0) { const turn = 0; ${turn} }`],
];
const firsts: [string, string][] = [
  ["no-turn-before-it-is-filled", "0"],
  ["turns-before-it-is-filled", "2"],
  ["nothing-before-it-is-filled", ""],
];
const between: [string, string][] = [
  ["other-code-in-the-turn", 'JSON.parse("1"); '],
  ["nothing-else-in-the-turn", ""],
];
const languages: [string, string, string][] = [
  ["strict", "cjs", '"use strict";\n'],
  ["sloppy", "cjs", ""],
  ["a-module", "mjs", ""],
];
const says = (call: string) => `try { console.log(String(${call})); } catch (error) { console.log(error.name); }`;

function inOneFile(at: number): Program {
  const take = <T>(from: readonly T[]) => {
    const one = from[at % from.length];
    at = Math.floor(at / from.length);
    return one;
  };
  const [language, extension, head] = take(languages);
  const [other, more] = take(between);
  const [first, turns] = take(firsts);
  const [loop, write] = take(loops);
  const [road, front, parameter, call, laid, handedFirst, handedSecond] = take(roads);
  const [holder, declaration, read] = take(holders);
  const text = `${head}${front ? front + "\n" : ""}function go(turns${parameter}) { let sum = 0; ${write(`${more}sum += ${call};`)} return sum; }
${turns ? says(`go(Number("${turns}")${handedFirst})`) + "\n" : ""}${declaration}
function read(turn) { return ${read} + turn; }
${laid ? laid + "\n" : ""}${says(`go(Number("3")${handedSecond})`)}
`;
  return { name: `${holder}--${road}--${loop}--${first}--${other}--${language}`, extension, text };
}
const numberInOneFile =
  holders.length * roads.length * loops.length * firsts.length * between.length * languages.length;

/** What loads stands in the loop. */
const helper = `const held = { width: Number("5") };\nfunction read(turn) { return held.width + turn; }\n`;
const loaders: [string, string, (bound: string) => string, string][] = [
  [
    "a-require-in-a-loop-of-the-body",
    "cjs",
    bound =>
      `let sum = 0;\nfor (let turn = 0; turn < Number("${bound}"); turn++) { const helper = require("./helper.cjs"); sum += helper.read(turn); }\nconsole.log(String(sum));\n`,
    `// @filename: ./helper.cjs\n${helper}exports.read = read;\n`,
  ],
  [
    "a-require-in-a-loop-of-a-function",
    "cjs",
    bound =>
      `function go(turns) { let sum = 0; for (let turn = 0; turn < turns; turn++) { const helper = require("./helper.cjs"); sum += helper.read(turn); } return sum; }\nconsole.log(String(go(Number("${bound}"))));\n`,
    `// @filename: ./helper.cjs\n${helper}exports.read = read;\n`,
  ],
  [
    "a-require-of-a-module-in-a-loop",
    "cjs",
    bound =>
      `let sum = 0;\nfor (let turn = 0; turn < Number("${bound}"); turn++) { const helper = require("./helper.mjs"); sum += helper.read(turn); }\nconsole.log(String(sum));\n`,
    `// @filename: ./helper.mjs\n${helper}export { read };\n`,
  ],
  [
    "an-import-awaited-in-a-loop",
    "mjs",
    bound =>
      `let sum = 0;\nfor (let turn = 0; turn < Number("${bound}"); turn++) { const helper = await import("./helper.mjs"); sum += helper.read(turn); }\nconsole.log(String(sum));\n`,
    `// @filename: ./helper.mjs\n${helper}export { read };\n`,
  ],
  [
    "a-require-at-the-first-turn-alone",
    "cjs",
    bound =>
      `let sum = 0, helper;\nfor (let turn = 0; turn < Number("${bound}"); turn++) { helper ??= require("./helper.cjs"); sum += helper.read(turn); }\nconsole.log(String(sum));\n`,
    `// @filename: ./helper.cjs\n${helper}exports.read = read;\n`,
  ],
  [
    "a-ring-that-calls-before-it-is-filled",
    "mjs",
    bound =>
      `import { go } from "./first.mjs";\nconsole.log(String(go(Number("3"))));\n// @filename: ./first.mjs\nimport { held } from "./second.mjs";\nexport function go(turns) { let sum = 0; for (let turn = 0; turn < turns; turn++) { JSON.parse("1"); sum += held.width + turn; } return sum; }\n// @filename: ./second.mjs\nimport { go } from "./first.mjs";\ntry { console.log(String(go(Number("${bound}")))); } catch (error) { console.log(error.name); }\nexport const held = { width: Number("5") };\n`,
    "",
  ],
];
const bounds = ["0", "1", "3"];
function withALoader(at: number): Program {
  const [name, extension, write, files] = loaders[Math.floor(at / bounds.length)];
  const bound = bounds[at % bounds.length];
  return { name: `${name}--${bound}-turns`, extension, text: write(bound) + files };
}
const numberWithALoader = loaders.length * bounds.length;

/** A function of the library is called in a loop, and nothing in front of the loop has touched its module. */
const calls: [string, string, string][] = [
  ["node:util", "inspect", "util.inspect(value)"],
  ["node:util", "format", 'util.format("%s|%o", value, value)'],
  ["node:util", "isDeepStrictEqual", "util.isDeepStrictEqual(value, value)"],
  ["node:util", "types-isMap", "util.types.isMap(value)"],
  ["node:util", "stripVTControlCharacters", "util.stripVTControlCharacters(String(value))"],
  ["node:path", "join", 'path.join("a", String(value))'],
  ["node:path", "win32-join", 'path.win32.join("a", String(value))'],
  ["node:path", "basename", 'path.basename("/a/" + String(value))'],
  ["node:path", "relative", 'path.relative("/a/b", "/a/" + String(value))'],
  ["node:url", "format", 'url.format({ host: "made-up.example", pathname: "/" + String(value) })'],
  ["node:url", "fileURLToPath", 'url.fileURLToPath("file:///a/" + encodeURIComponent(String(value)))'],
  ["node:querystring", "stringify", "querystring.stringify({ a: String(value) })"],
  ["node:querystring", "parse", 'JSON.stringify(querystring.parse("a=" + encodeURIComponent(String(value))))'],
  ["node:assert", "deepStrictEqual", "assert.deepStrictEqual(value, value)"],
  ["node:assert", "ok", "assert.ok(value)"],
  ["node:events", "listenerCount", 'new events.EventEmitter().listenerCount("made-up")'],
  ["node:buffer", "from", 'buffer.Buffer.from(String(value)).toString("hex")'],
  ["node:buffer", "byteLength", "buffer.Buffer.byteLength(String(value))"],
  ["node:string_decoder", "write", 'new string_decoder.StringDecoder("utf8").write(Buffer.from(String(value)))'],
  ["node:os", "EOL", "JSON.stringify(os.EOL)"],
  ["node:zlib", "crc32", "zlib.crc32(String(value))"],
  ["node:crypto", "createHash", 'crypto.createHash("sha1").update(String(value)).digest("hex")'],
  ["node:stream", "Readable-from", "typeof stream.Readable.from([value]).read"],
  ["node:timers", "clearTimeout", "timers.clearTimeout(undefined)"],
  ["node:punycode", "toASCII", "punycode.toASCII(String(value))"],
  ["node:module", "isBuiltin", "modules.isBuiltin(String(value))"],
];
const brings: [string, string, (from: string, name: string) => string][] = [
  ["a-default-import", "mjs", (from, name) => `import ${name} from "${from}";`],
  ["a-namespace", "mjs", (from, name) => `import * as ${name} from "${from}";`],
  ["a-require", "cjs", (from, name) => `const ${name} = require("${from}");`],
];
const places: [string, (call: string) => string][] = [
  ["a-loop-of-the-body", call => `for (const value of values) console.log(String(${call}));`],
  [
    "a-counted-loop-of-the-body",
    call => `for (let at = 0; at < values.length; at++) { const value = values[at]; console.log(String(${call})); }`,
  ],
  [
    "a-loop-of-a-function",
    call =>
      `function go(values) { let said = ""; for (const value of values) said += String(${call}) + ";"; return said; }\nconsole.log(go(values));`,
  ],
  [
    "a-loop-of-no-turn-first",
    call =>
      `function go(values) { let said = ""; for (const value of values) said += String(${call}) + ";"; return said; }\nconsole.log(go([]));\nconsole.log(go(values));`,
  ],
  [
    "a-call-in-front-of-the-loop",
    call =>
      `{ const value = values[0]; console.log(String(${call})); }\nfor (const value of values) console.log(String(${call}));`,
  ],
  ["twice-in-a-turn", call => `for (const value of values) console.log(String(${call}), String(${call}));`],
  ["no-loop", call => `{ const value = values[0]; console.log(String(${call})); }`],
];
function ofTheLibrary(at: number): Program {
  const [place, write] = places[at % places.length];
  at = Math.floor(at / places.length);
  const [bring, extension, bringIt] = brings[at % brings.length];
  const [from, member, call] = calls[Math.floor(at / brings.length)];
  // `module` is a name of every CommonJS file already.
  const name = from === "node:module" ? "modules" : from.slice("node:".length);
  return {
    name: `${name}-${member}--${place}--${bring}`,
    extension,
    text: `${bringIt(from, name)}\nconst values = [{}, [], new Map(), "a", 1];\n${write(call)}\n`,
  };
}
const numberOfTheLibrary = calls.length * brings.length * places.length;

/** It all stands inside a function: what is read is a variable of a call of that function, and a callee that may be copied into the loop reads it. Two calls make two of each, and they must not be taken for one. */
const keeps: [string, string, string][] = [
  ["its-parameter", "", "by"],
  ["a-constant", "const held = by + 1;", "held"],
  ["a-record", "const held = { width: by };", "held.width"],
  ["a-variable-filled-by-a-closure", "let held; const fill = () => { held = by; }; fill();", "held"],
  ["a-variable-that-each-read-raises", "let held = by;", "held++"],
];
const makes: [string, (keep: string, read: string, loop: (turn: string) => string) => string, string][] = [
  [
    "a-private-method-in-a-loop-of-a-method",
    (keep, read, loop) =>
      `function make(by) { ${keep} return new (class Made { #step(x) { return x + ${read}; } go(turns) { let sum = 0; ${loop("sum += this.#step(turn & 3);")} return sum; } })(); }`,
    "go",
  ],
  [
    "a-private-method-behind-a-method-in-a-loop-of-the-file",
    (keep, read, loop) =>
      `function make(by) { ${keep} const made = new (class Made { #step(x) { return x + ${read}; } of(x) { return this.#step(x); } })(); return { go(turns) { return walk(made, turns); } }; }\nfunction walk(made, turns) { let sum = 0; ${loop("sum += made.of(turn & 3);")} return sum; }`,
    "go",
  ],
  [
    "a-method-in-a-loop-of-a-method",
    (keep, read, loop) =>
      `function make(by) { ${keep} return new (class Made { step(x) { return x + ${read}; } go(turns) { let sum = 0; ${loop("sum += this.step(turn & 3);")} return sum; } })(); }`,
    "go",
  ],
  [
    "a-static-private-method",
    (keep, read, loop) =>
      `function make(by) { ${keep} return class Made { static #step(x) { return x + ${read}; } static go(turns) { let sum = 0; ${loop("sum += Made.#step(turn & 3);")} return sum; } }; }`,
    "go",
  ],
  [
    "a-private-field",
    (keep, read, loop) =>
      `function make(by) { ${keep} return new (class Made { #kept = () => ${read}; go(turns) { let sum = 0; ${loop("sum += this.#kept() + (turn & 3);")} return sum; } })(); }`,
    "go",
  ],
  [
    "an-inner-function",
    (keep, read, loop) =>
      `function make(by) { ${keep} function step(x) { return x + ${read}; } return { go(turns) { let sum = 0; ${loop("sum += step(turn & 3);")} return sum; } }; }`,
    "go",
  ],
  [
    "a-function-handed-to-the-maker",
    (keep, read, loop) =>
      `function wrap(step) { return { go(turns) { let sum = 0; ${loop("sum += step(turn & 3);")} return sum; } }; }\nfunction make(by) { ${keep} return wrap(x => x + ${read}); }`,
    "go",
  ],
];
const reaches: [string, (made: string, turns: string) => string][] = [
  ["straight", (made, turns) => `${made}.go(${turns})`],
  ["under-a-text", (made, turns) => `${made}[String("go")](${turns})`],
  ["out-of-a-list", (made, turns) => `[${made}][Number("0")].go(${turns})`],
];
function inAFunction(at: number): Program {
  const take = <T>(from: readonly T[]) => {
    const one = from[at % from.length];
    at = Math.floor(at / from.length);
    return one;
  };
  // An environment that is made once may be laid among the variables of the file; one that is made twice may not.
  const times = take(["made-once", "made-twice"]);
  const [reach, call] = take(reaches);
  const [loop, write] = take(loops);
  const [keep, declaration, read] = take(keeps);
  const [make, text] = take(makes);
  const asked =
    times === "made-once"
      ? [call("first", 'Number("0")'), call("first", 'Number("3")'), call("first", 'Number("40")')]
      : [
          call("first", 'Number("0")'),
          call("first", 'Number("3")'),
          call("second", 'Number("3")'),
          call("first", 'Number("40")'),
          call("second", 'Number("0")'),
        ];
  return {
    name: `${make}--${keep}--${loop}--${reach}--${times}`,
    extension: "mjs",
    text: `${text(declaration, read, write)}\nconst first = make(Number("1"))${times === "made-once" ? "" : ', second = make(Number("20"))'};\nconsole.log([${asked.join(", ")}].join(" "));\n`,
  };
}
const numberInAFunction = makes.length * keeps.length * loops.length * reaches.length * 2;

const all = numberInOneFile + numberWithALoader + numberOfTheLibrary + numberInAFunction;
function program(at: number): Program {
  if (at < numberWithALoader) return withALoader(at);
  if (at < numberWithALoader + numberOfTheLibrary) return ofTheLibrary(at - numberWithALoader);
  if (at >= numberWithALoader + numberOfTheLibrary + numberInOneFile)
    return inAFunction(at - numberWithALoader - numberOfTheLibrary - numberInOneFile);
  return inOneFile(at - numberWithALoader - numberOfTheLibrary);
}
const lay = (folder: string, at: number, { name, extension, text }: Program) =>
  writeFileSync(`${folder}/${String(at).padStart(5, "0")}-${name}.${extension}`, text);

if (process.argv[2] === "count") console.log(all);
else if (process.argv[2] === "named") {
  const [pattern, folder] = [new RegExp(process.argv[3]), process.argv[4]];
  mkdirSync(folder, { recursive: true });
  let written = 0;
  for (let at = 0; at < all; at++) {
    const one = program(at);
    if (!pattern.test(one.name)) continue;
    lay(folder, at, one);
    written++;
  }
  console.log(written);
} else {
  const [folder, from, count] = [process.argv[2], Number(process.argv[3] ?? 0), Number(process.argv[4] ?? all)];
  mkdirSync(folder, { recursive: true });
  for (let at = from; at < Math.min(all, from + count); at++) lay(folder, at, program(at));
}
