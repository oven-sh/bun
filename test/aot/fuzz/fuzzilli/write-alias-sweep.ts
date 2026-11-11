// A loop reads a row under a key, and in the same turn reads through an alias of a variable that is stored and stored back: where the holder and the key stand, times where the variable lives, times how the
// alias is taken, times how the variable is stored back, times what is read through the alias, times what the rows hold. Each program holds one of each and is built alone.
//
//   bun write-alias-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<holder>--<variable>--<alias>--<back>--<read>--<rows>.cjs
//   bun write-alias-sweep.ts count
//   bun write-alias-sweep.ts named <pattern> <folder> [most]
//
// A compiler that finds `data[key]` once in front of a loop remembers the row under two values, the holder and the key. A read in the loop may take that row only if its own operands are those values. An
// alias holds what the variable held when the alias was taken, whatever the variable holds by the time the read is compiled: `cursor = spare; const second = cursor; cursor = data; second[key]` reads the
// row of `spare`.
import { mkdirSync, writeFileSync } from "fs";

// What stands in front of the function, its parameters, what it is called with, and the names of the holder and the key in it.
const holders: [string, string, string, string, string, string][] = [
  ["constants-of-the-file", "const data = box.holder, w = box.name;", "", "", "data", "w"],
  ["parameters", "", "data, w", "box.holder, box.name", "data", "w"],
  ["fields-of-a-parameter", "", "all", "box", "all.holder", "all.name"],
];

// What declares the variable, in front of the function or inside it, and how it is named. HOLDER is the holder.
const variables: [string, string, string, string][] = [
  ["a-let-of-the-file", "let cursor = null;", "", "cursor"],
  ["a-var-of-the-file", "var cursor = null;", "", "cursor"],
  ["a-field-of-a-record-of-the-file", "const state = { cursor: null };", "", "state.cursor"],
  [
    "a-let-of-the-function-that-a-closure-stores",
    "",
    "let cursor = null;\n  const put = next => {\n    cursor = next;\n  };\n  put(null);",
    "cursor",
  ],
  ["a-let-of-the-function", "", "let cursor = null;", "cursor"],
];

// V is the variable.
const aliases: [string, string][] = [
  ["a-constant", "const second = V;"],
  ["a-let", "let second = V;"],
  ["by-a-pattern", "const [second] = [V];"],
  ["through-a-function", "const second = pass(V);"],
  ["an-arm-of-a-choice", "const second = i >= 0 ? V : null;"],
];

// ALIAS is where the alias is taken.
const backs: [string, string][] = [
  ["stored-and-stored-back", "V = spare;\n    ALIAS\n    V = HOLDER;"],
  ["stored-back-by-a-callee", "V = spare;\n    ALIAS\n    restore(HOLDER);"],
  ["stored-in-the-turn-before", "ALIAS\n    V = i % 2 ? HOLDER : spare;"],
  ["stored-and-left", "V = spare;\n    ALIAS"],
];

// K is the key.
const reads: [string, string][] = [
  ["the-length-of-the-row", "(second === null ? 0 : second[K].length)"],
  ["its-first-element", "(second === null ? 0 : second[K][0])"],
  ["the-element-of-the-turn", "(second === null ? 0 : second[K][i % 3])"],
  ["the-length-of-the-other-row", "(second === null ? 0 : second[box.second].length)"],
  ["is-it-the-same-row", "(second !== null && second[K] === HOLDER[K] ? 1 : 2)"],
];

const rows: [string, string, string][] = [
  ["whole-numbers", "[1,2,3,4,5,6,7,8,9,10,11,12]", "[50,60,70,80,90,100]"],
  ["fractions", "[1.5,2.5,3.5,4.5,5.5,6.5,7.5,8.5,9.5]", "[50.5,60.5,70.5,80.5]"],
  ["texts", '["a","b","c","d","e","f","g","h","i","j"]', '["x","y","z","v"]'],
];

const all = holders.length * variables.length * aliases.length * backs.length * reads.length * rows.length;

function write(at: number): { name: string; text: string } {
  const pick = <T>(list: readonly T[]): T => {
    const one = list[at % list.length];
    at = Math.floor(at / list.length);
    return one;
  };
  const [holder, inFront, takes, given, held, key] = pick(holders);
  const [variable, declared, inside, named] = pick(variables);
  const [alias, taken] = pick(aliases);
  const [back, stores] = pick(backs);
  const [read, asked] = pick(reads);
  const [row, first, second] = pick(rows);
  const local = inside !== "";
  const restores = local ? "" : `function restore(next) {\n  ${named} = next;\n}`;
  const turn = stores
    .replace("restore(HOLDER);", local ? `${named} = HOLDER;` : "restore(HOLDER);")
    .replace("ALIAS", taken)
    .replaceAll("V", named)
    .replaceAll("HOLDER", held);
  const text = [
    `const box = JSON.parse(\`{"name":"rows","second":"other","holder":{"rows":${first},"other":[100,200,300]},"spare":{"rows":${second},"other":[7,7]}}\`);`,
    "const spare = box.spare;",
    inFront,
    declared,
    "function pass(x) {\n  return x;\n}",
    restores,
    `function f(${takes}) {`,
    inside && `  ${inside}`,
    `  let s = ${row === "texts" ? '""' : "0"},\n    n = 0;`,
    `  for (let i = 0; i < ${held}[${key}].length; i++) {`,
    `    s = s + ${held}[${key}][i];`,
    `    ${turn}`,
    `    n = n + ${asked.replaceAll("K", key).replaceAll("HOLDER", held)};`,
    "  }",
    '  return s + ":" + n;',
    "}",
    `console.log(f(${given}), f(${given}));`,
  ]
    .filter(Boolean)
    .join("\n");
  return { name: `${holder}--${variable}--${alias}--${back}--${read}--${row}.cjs`, text: text + "\n" };
}

const pad = (at: number) => String(at).padStart(4, "0");
if (process.argv[2] === "count") console.log(all);
else if (process.argv[2] === "named") {
  const [pattern, folder, atMost] = [new RegExp(process.argv[3]), process.argv[4], Number(process.argv[5] ?? 500)];
  mkdirSync(folder, { recursive: true });
  let laid = 0;
  for (let at = 0; at < all && laid < atMost; at++) {
    const program = write(at);
    if (!pattern.test(program.name)) continue;
    writeFileSync(`${folder}/${pad(at)}-${program.name}`, program.text);
    laid++;
  }
  console.log(laid);
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
