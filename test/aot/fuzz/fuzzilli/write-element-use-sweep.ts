// What a loop does with one element: the kind of the list, times the index, times the use of the element, times the form of the loop.
// Every program asks it of the list as a constant of the file, as a parameter and as a field of an object, and then of two lists of other kinds.
//
//   bun write-element-use-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<list>--<index>--<use>--<loop>.mjs or .ts
//   bun write-element-use-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

const lists: [name: string, text: string][] = [
  ["ints", "[3, 1, 4, 1, 5]"],
  ["doubles", "[0.5, 2.5, -1.5, 8.25]"],
  ["mixed-numbers", "[1, 2.5, -0, 3, NaN]"],
  ["parsed-ints", 'JSON.parse("[7, 2, 9, 4]")'],
  ["parsed-mixed", 'JSON.parse("[7, 2.5, null, \\"t\\"]")'],
  ["one-object", "[{ size: undefined }]"],
  ["objects", "[{ size: 1 }, { size: 2.5 }, { size: 3 }]"],
  ["texts", '["a", "bc", "", "2"]'],
  ["holes", "[1, , 3, , 5]"],
  ["empty", "[]"],
  ["booleans", "[true, false, true]"],
  ["nothing", "[undefined, null, undefined]"],
  ["lists", "[[1, 2], [3], []]"],
  ["filled", "new Array(4).fill(0)"],
  ["made", "Array.from({ length: 5 }, (_, at) => at * at)"],
  ["int32s", "new Int32Array([5, -1, 2147483647])"],
  ["float64s", "new Float64Array([0.5, -0, NaN, 3])"],
  ["bytes", "new Uint8Array([1, 200, 3])"],
  ["no-bytes", "new Uint8Array(0)"],
  ["text", '"abca"'],
  ["array-like", "{ length: 3, 0: 1, 2: 2.5 }"],
];
// `l` is the list, `i` the counter of the loop, `j` the counter of a loop inside, `n` a parameter.
const indexes: [name: string, text: string][] = [
  ["i", "i"],
  ["next", "i + 1"],
  ["previous", "i - 1"],
  ["from-the-end", "n - 1 - i"],
  ["length-from-the-end", "l.length - 1 - i"],
  ["half", "i >> 1"],
  ["remainder", "i % 3"],
  ["masked", "i & 3"],
  ["invariant", "n"],
  ["twice", "i * 2"],
  ["sum", "i + j"],
  ["inner", "j"],
  ["first", "0"],
  ["negative", "-1 - i"],
  ["fraction", "i + 0.5"],
  ["as-text", "String(i)"],
  ["unsigned", "(i - 1) >>> 0"],
];
// `x` is the element.
const uses: [name: string, text: string][] = [
  ["less-breaks", "if (x < 2) break;"],
  ["less-counts", "if (x < 2) r++;"],
  ["greater", "if (x >= 2) r += 2;"],
  ["same", "if (x === 2) r++;"],
  ["nothing-counts", "if (x == null) r++;"],
  ["undefined-continues", "if (x === undefined) continue;\nr++;"],
  ["truth", "if (x) r++;"],
  ["not", "if (!x) r += 3;"],
  ["added", "r += x;"],
  ["doubled", "r += x * 2;"],
  ["whole", "r += x | 0;"],
  ["shifted", "r += x >> 1;"],
  ["negated", "r = -x;"],
  ["unsigned-whole", "r += x >>> 0;"],
  ["as-text", 't += x + ",";'],
  ["typeof", "t += typeof x;"],
  ["or-else", "r += x ?? 10;"],
  ["or-size", "t += x?.size;"],
  ["stored", "out[i] = x;"],
  ["pushed", "out.push(x);"],
  ["closed-over", "if (x < 2) out.push(() => i);"],
  ["written-back", "l[i] = x;"],
  ["counted-up", "state.last = x;\nr = state.last;"],
  ["most", "r = Math.max(r, x);"],
  ["floored", "r += Math.floor(x);"],
  ["switched", "switch (x) {\n  case 1:\n    r++;\n    break;\n  case undefined:\n    r += 5;\n}"],
  ["compared-with-next", "if (x > l[i + 1]) r++;"],
  ["kept-best", "if (x > best) best = x;\nr = best;"],
  ["not-a-number", "if (isNaN(x)) r += 7;"],
  ["and-one", "if (x & 1) r++;"],
];
// `@` is what is done with the element, every time with a name of its own.
const loops: [name: string, text: string][] = [
  ["up", "for (let i = 0; i < n; i++) {\n@\n}"],
  ["up-to-the-length", "for (let i = 0; i < l.length; i++) {\n@\n}"],
  ["down", "for (let i = n - 1; i >= 0; i--) {\n@\n}"],
  ["down-above-0", "for (let i = n - 1; i > 0; i--) {\n@\n}"],
  ["while-down-first", "let i = n;\nwhile (--i >= 0) {\n@\n}"],
  ["while-down-behind", "let i = 3;\nwhile (i-- > 0) {\n@\n}"],
  ["do", "let i = 0;\ndo {\n@\n} while (++i < 3);"],
  ["do-down", "let i = 3;\ndo {\n@\n} while (--i > 0);"],
  ["over-a-list", "for (const i of [0, 1, 2]) {\n@\n}"],
  ["by-two", "for (let i = 1; i < n; i += 2) {\n@\n}"],
  ["endless", "let i = 0;\nfor (;;) {\n  if (i++ > 3) break;\n@\n}"],
  ["inner-3", "for (let i = 0; i < n; i++) {\n  for (let j = 0; j < 3; j++) {\n@\n  }\n}"],
  ["inner-down", "for (let i = n - 1; i > 0; i--) {\n  for (let j = 3; j >= 0; j--) {\n@\n  }\n}"],
  ["inner-while", "let i = 0;\ndo {\n  let j = 3;\n  while (--j >= 0) {\n@\n  }\n} while (++i < 3);"],
  ["one-behind-the-other", "for (let i = 0; i < 3; i++) {\n@\n}\nfor (let k = 0; k < n; k++) r += 1;"],
  ["filled-first", "for (let k = 0; k < n; k++) out[k] = k;\nfor (let i = 0; i < n; i++) {\n@\n}"],
];
const total = lists.length * indexes.length * uses.length * loops.length;

function write(cell: number): { name: string; text: string } {
  let rest = cell;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const list = pick(lists);
  const index = pick(indexes);
  const use = pick(uses);
  const loop = pick(loops);
  const others = [lists[(cell * 7 + 3) % lists.length], lists[(cell * 11 + 8) % lists.length]];
  const isTyped = cell % 5 === 4;
  const any = isTyped ? ": any" : "";
  const inner = loop[1].includes("let j");
  const body = (read: string) => {
    const element = `const x${any} = ${read}[${inner ? index[1] : index[1].replace(/\bj\b/g, "1")}];`.replaceAll(
      /\bl\b/g,
      read,
    );
    const step = use[1].replaceAll(/\bl\b/g, read);
    // Half of the uses read the element where they use it.
    const lines =
      cell % 2 && !use[1].includes("?.")
        ? step.replace(/\bx\b/, element.slice(element.indexOf("= ") + 2, -1))
        : element + "\n" + step;
    const isShort = lines.includes("const x") || !/\bx\b/.test(lines);
    return isShort ? lines : element + "\n" + step;
  };
  const work = (name: string, parameters: string, read: string, before = "") => [
    `function ${name}(${parameters}) {`,
    `  let r${any} = 0;`,
    '  let t = "";',
    `  let best${any} = -1;`,
    `  const out${any} = [];`,
    ...(before ? ["  " + before] : []),
    ...loop[1]
      .replaceAll(/\bl\b/g, read)
      .replace("@", () => body(read).replaceAll(/^/gm, "  "))
      .split("\n")
      .map(line => "  " + line),
    '  return [r, t, best, out.length, Array.from(out, shown).join()].map(shown).join("|");',
    "}",
  ];
  const ask = (call: string) => ["try {", `  console.log(${call});`, "} catch (error) {", `  console.log("threw", ${isTyped ? "(error as any)" : "error"}?.name);`, "}"]; // prettier-ignore
  const number = isTyped ? ": number" : "";
  const lines = [
    `const list${any} = ${list[1]};`,
    `const state${any} = { list: ${list[1]}, last: 0 };`,
    `function shown(value${any})${isTyped ? ": string" : ""} {`,
    '  if (typeof value === "function") return "f" + value();',
    '  return Object.is(value, -0) ? "-0" : typeof value === "object" && value !== null ? "{" + Object.entries(value).join(";") + "}" : String(value);',
    "}",
    ...work("ofTheFile", `n${number}`, "list"),
    ...work("given", `l${any}, n${number}`, "l"),
    ...work("ofAField", `o${any}, n${number}`, "o.list"),
    ...work("ofALocal", `n${number}`, "own", `const own${any} = ${list[1]};`),
    ...[3, 4].flatMap(n => [...ask(`ofTheFile(${n})`), ...ask(`ofALocal(${n})`)]),
    ...(cell % 3 === 1 ? [`const count${number} = JSON.parse("4");`, ...ask("ofTheFile(count)"), ...ask("ofALocal(count)"), ...ask("ofAField(state, count)")] : []), // prettier-ignore
    ...ask(`given(${list[1]}, 3)`),
    ...ask("ofAField(state, 4)"),
    ...others.flatMap(other => [
      ...ask(`given(${other[1]}, 3)`),
      ...ask(`ofAField({ list: ${other[1]}, last: 1 }, 2)`),
    ]),
    "console.log(shown(list), shown(state.last));",
    ...(isTyped ? ["export {};"] : []),
  ];
  return {
    name: `${list[0]}--${index[0]}--${use[0]}--${loop[0]}${isTyped ? ".ts" : ".mjs"}`,
    text: lines.join("\n") + "\n",
  };
}

const padNumber = (index: number) => String(index).padStart(6, "0");
if (process.argv[2] === "count") console.log(total);
else {
  const [folder, from, count, stride] = [process.argv[2], Number(process.argv[3] ?? 0), Number(process.argv[4] ?? total), Number(process.argv[5] ?? 1)]; // prettier-ignore
  mkdirSync(folder, { recursive: true });
  for (let step = 0; step < Math.min(count, total); step++) {
    const index = (from + step * stride) % total;
    const program = write(index);
    writeFileSync(`${folder}/${padNumber(index)}-${program.name}`, program.text);
  }
  console.log(Math.min(count, total));
}
