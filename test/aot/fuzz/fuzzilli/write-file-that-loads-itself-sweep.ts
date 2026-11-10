// A file loads itself and its body does not end well, and the program loads it more than once: how it loads itself, times what ends its body, times who loads it first, second and third, times what it hands on,
// times a leaf that it loads beside itself, times whether the loads wait for one another, times a function in the entry that nobody calls. Once for a CommonJS file and once for an ES file. Each program holds one of
// each and is built alone.
//
//   bun write-file-that-loads-itself-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<kind>--<self>--<end>--<loads>--<handed>--<leaf>--<waits>--<entry>.cjs
//   bun write-file-that-loads-itself-sweep.ts count
//   bun write-file-that-loads-itself-sweep.ts named <pattern> <folder> [most]
//
// A load that failed is forgotten, so the next load runs the file again, with a module object of its own. At the exit every program prints what each load came to, the children of the entry's module object, each
// thing that a run handed on (of a module object its children, and which of the handed objects each child is).
import { mkdirSync, writeFileSync } from "fs";

type Kind = {
  name: string;
  part: string;
  leaf: string;
  leafText: string;
  opens: string;
  closes: string;
  selfs: [string, string][];
  ends: [string, string][];
  handeds: [string, string][];
  loadsLeaf: string;
};

// Which of two loads in flight ends first is a matter of time: what a load comes to is booked under the load, and what the file's load of itself comes to is sorted.
const told = (books: string, what: string) =>
  `.then(() => ${books}"${what} loaded"), error => ${books}"${what} rejected " + error.name));`;

const kinds: Kind[] = [
  {
    name: "a-commonjs-file",
    part: "part.cjs",
    leaf: "leaf.cjs",
    leafText: "exports.leaf = true;",
    opens: 'exports.early = 1;\nnote("part runs");',
    closes: "exports.late = 2;",
    selfs: [
      ["requires-itself", 'require("./part.cjs");'],
      ["imports-itself-at-run-time", 'import("./part.cjs")' + told("aside(", "itself")],
      ["requires-itself-by-a-require-it-made", 'require("node:module").createRequire(__filename)("./part.cjs");'],
    ],
    ends: [
      ["a-throw", 'throw new Error("no");'],
      ["a-throw-out-of-a-call", 'JSON.parse("{");'],
      ["a-missing-file", 'require("./absent.cjs");'],
      ["an-exit-in-a-finally", 'try {\n  throw new Error("no");\n} finally {\n  process.exit(0);\n}'],
      ["nothing", ""],
    ],
    handeds: [
      ["its-module", "(globalThis.kept ??= []).push(module);"],
      ["its-require", "(globalThis.kept ??= []).push(require);"],
      ["its-exports", "(globalThis.kept ??= []).push(exports);"],
      ["nothing-handed-on", ""],
    ],
    loadsLeaf: 'require("./leaf.cjs");',
  },
  {
    name: "an-es-file",
    part: "part.mjs",
    leaf: "leaf.mjs",
    leafText: "export const leaf = true;",
    opens: 'import { createRequire } from "node:module";\nexport const early = 1;\nnote("part runs");',
    closes: "export const late = 2;",
    selfs: [
      ["imports-itself-by-a-statement", 'import "./part.mjs";'],
      ["imports-itself-at-run-time", 'import("./part.mjs")' + told("aside(", "itself")],
      [
        "requires-itself-by-a-require-it-made",
        'try {\n  createRequire(import.meta.url)("./part.mjs");\n} catch (error) {\n  aside("itself threw " + error.name);\n}',
      ],
    ],
    ends: [
      ["a-throw", 'throw new Error("no");'],
      ["a-throw-out-of-a-call", 'JSON.parse("{");'],
      ["a-missing-file", 'await import("./absent.mjs");'],
      ["an-await-that-rejects", 'await Promise.reject(new Error("no"));'],
      ["an-exit-in-a-finally", 'try {\n  throw new Error("no");\n} finally {\n  process.exit(0);\n}'],
      ["nothing", ""],
    ],
    handeds: [
      ["a-require-it-made", "(globalThis.kept ??= []).push(createRequire(import.meta.url));"],
      ["the-require-of-import-meta", "(globalThis.kept ??= []).push(import.meta.require);"],
      ["nothing-handed-on", ""],
    ],
    loadsLeaf: 'import "./leaf.mjs";',
  },
];

// R: require() under a try. I: import(). S: an import statement, in a file of its own that the entry imports.
const loads = ["RI", "IR", "RR", "II", "RS", "SR", "SI", "IS", "SS", "RRR", "III", "RIR", "IRI"];
const spelled: Record<string, string> = { R: "required", I: "imported", S: "by-a-statement" };

const leaves = ["no-leaf", "a-leaf-in-front", "a-leaf-behind"];
const waits = ["one-after-another", "all-begun-at-once"];
const entries = ["a-plain-entry", "an-idle-function-in-the-entry"];

const sizeOf = (kind: Kind) =>
  kind.selfs.length *
  kind.ends.length *
  loads.length *
  kind.handeds.length *
  leaves.length *
  waits.length *
  entries.length;
const all = kinds.reduce((sum, kind) => sum + sizeOf(kind), 0);

const indented = (text: string, by = "  ") => by + text.replaceAll("\n", "\n" + by);
const joined = (...parts: string[]) => parts.filter(Boolean).join("\n");

const head = `const path = require("node:path");
const said = [];
const loads = [];
const itself = [];
globalThis.note = text => said.push(text);
globalThis.aside = text => itself.push(text);
const book = (at, text) => (loads[at] = text);
const named = one => path.basename(String(one?.id ?? one?.filename ?? one));
function shown(one, handed) {
  if (typeof one === "function") return "function " + typeof one.resolve;
  if (one && "children" in one) return "module " + named(one) + " " + one.loaded + " [" + one.children.map(child => named(child) + "#" + handed.indexOf(child)).join("+") + "] " + Object.keys(one.exports ?? {}).join("+");
  return "object " + Object.keys(one).join("+");
}
process.on("exit", () => {
  const handed = globalThis.kept ?? [];
  console.log("SAID " + said.join(" . "));
  console.log("SAID the loads: " + Array.from(loads, one => one ?? "not ended").join(" . "));
  console.log("SAID of itself: " + itself.sort().join(" . "));
  console.log("SAID the children of the entry: " + module.children.map(child => named(child) + "#" + handed.indexOf(child)).join("+"));
  handed.forEach((one, at) => console.log("SAID handed on " + at + ": " + shown(one, handed)));
});`;

function write(at: number): { name: string; text: string } {
  let kind = kinds[0];
  if (at >= sizeOf(kind)) {
    at -= sizeOf(kind);
    kind = kinds[1];
  }
  const pick = <T>(list: readonly T[]): T => {
    const one = list[at % list.length];
    at = Math.floor(at / list.length);
    return one;
  };
  const order = pick(loads);
  const [end, ends] = pick(kind.ends);
  const [self, loadsItself] = pick(kind.selfs);
  const [handed, handsOn] = pick(kind.handeds);
  const leaf = pick(leaves);
  const wait = pick(waits);
  const entry = pick(entries);
  const awaited = wait === "one-after-another" ? "await " : "";
  const helpers: string[] = [];
  const steps = [...order].map((letter, at) => {
    if (letter === "R")
      return `try {\n  book(${at}, "required " + Object.keys(require("./${kind.part}")).join("+"));\n} catch (error) {\n  book(${at}, "require threw " + error.name);\n}`;
    if (letter === "I")
      return `${awaited}import("./${kind.part}").then(names => book(${at}, "imported " + Object.keys(names).join("+")), error => book(${at}, "import rejected " + error.name));`;
    helpers.push(`// @filename: ./by-a-statement-${helpers.length + 1}.mjs\nimport "./${kind.part}";`);
    return `${awaited}import("./by-a-statement-${helpers.length}.mjs")${told(`book(${at}, `, "the statement")}`;
  });
  const runs = joined(...steps, 'note("the entry ends");');
  const main = joined(
    head,
    awaited ? joined("(async () => {", indented(runs), "})();") : runs,
    entry === "a-plain-entry" ? "" : 'function idle() {\n  var held = Function.prototype;\n  return "zzz" in Bun;\n}',
  );
  const part = joined(
    kind.opens,
    leaf === "a-leaf-in-front" ? kind.loadsLeaf : "",
    loadsItself,
    leaf === "a-leaf-behind" ? kind.loadsLeaf : "",
    handsOn,
    ends,
    kind.closes,
  );
  return {
    name: `${kind.name}--${self}--${end}--${[...order].map(letter => spelled[letter]).join("-then-")}--${handed}--${leaf}--${wait}--${entry}.cjs`,
    text:
      joined(
        main,
        `// @filename: ./${kind.part}`,
        part,
        leaf === "no-leaf" ? "" : `// @filename: ./${kind.leaf}\n${kind.leafText}`,
        ...helpers,
      ) + "\n",
  };
}

const pad = (at: number) => String(at).padStart(5, "0");
if (process.argv[2] === "count") console.log(all);
else if (process.argv[2] === "named") {
  const [pattern, folder, atMost] = [new RegExp(process.argv[3]), process.argv[4], Number(process.argv[5] ?? 500)];
  mkdirSync(folder, { recursive: true });
  let laidOut = 0;
  for (let at = 0; at < all && laidOut < atMost; at++) {
    const program = write(at);
    if (!pattern.test(program.name)) continue;
    writeFileSync(`${folder}/${pad(at)}-${program.name}`, program.text);
    laidOut++;
  }
  console.log(laidOut);
} else {
  const [folder, from, count, stride] = [process.argv[2], Number(process.argv[3] ?? 0), Number(process.argv[4] ?? all), Number(process.argv[5] ?? 1)]; // prettier-ignore
  mkdirSync(folder, { recursive: true });
  for (let step = 0; step < Math.min(count, all); step++) {
    const at = (from + step * stride) % all;
    const program = write(at);
    writeFileSync(`${folder}/${pad(at)}-${program.name}`, program.text);
  }
  console.log(Math.min(count, all));
}
