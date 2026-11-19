// Remainders and quotients: where the dividend lies, times how it is written, times the divisor, times the operation, times what the result is used as, times the loop around it, times how the numbers are handed over.
//
//   bun write-remainder-use-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<base>--<dividend>--<divisor>--<operation>--<use>--<shape>.ts or .mjs
//   bun write-remainder-use-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

// What shows most stands more than once.
const bases: [name: string, text: string][] = [
  ["at-53", "2 ** 53"],
  ["at-53", "2 ** 53"],
  ["at-53", "2 ** 53"],
  ["zero", "0"],
  ["minus-three", "-3"],
  ["below-31", "2 ** 31 - 3"],
  ["minus-31", "-(2 ** 31) + 2"],
  ["below-minus-31", "-(2 ** 31) - 2"],
  ["above-31", "2 ** 31 + 1"],
  ["below-32", "2 ** 32 - 3"],
  ["above-32", "2 ** 32 + 5"],
  ["minus-32", "-(2 ** 32) - 1"],
  ["below-53", "2 ** 53 - 4"],
  ["at-53", "2 ** 53"],
  ["above-53", "2 ** 53 + 6"],
  ["just-below-53", "2 ** 53 - 1"],
  ["minus-53", "-(2 ** 53) - 2"],
  ["half", "0.5"],
  ["minus-half", "-0.5"],
  ["half-above-31", "2 ** 31 + 0.5"],
  ["half-below-52", "2 ** 51 + 0.5"],
  ["not-a-number", "0 / 0"],
  ["infinity", "1 / 0"],
  ["minus-infinity", "-1 / 0"],
  ["minus-zero", "-0"],
  ["wide", "1e300"],
];
// `x` is the base, `i` the counter of the inner loop, `n` that of the outer one.
const dividends: [name: string, text: string][] = [
  ["sum", "x + i"],
  ["difference", "x - i"],
  ["product", "x * i"],
  ["counter", "i"],
  ["itself", "x"],
  ["outer", "n"],
  ["sum-with-outer", "x + n * 3 + i"],
  ["minus", "-(x + i)"],
  ["int32", "(x + i) | 0"],
  ["uint32", "(x + i) >>> 0"],
  ["floor", "Math.floor(x / 2) + i"],
  ["element", "list[i]"],
  ["field", "row.x"],
  ["carried", "at++"],
  ["bits", "(x ^ i)"],
];
const divisors: [name: string, text: string][] = [
  ...["1", "2", "3", "7", "8", "10", "1000", "-1", "-2", "-3", "-8", "0", "-0", "0.5", "1.5", "-2.5"].map((value): [string, string] => ["by-" + value, value]), // prettier-ignore
  ["by-31", "2147483648"],
  ["by-minus-31", "-2147483648"],
  ["by-32", "4294967296"],
  ["by-53", "9007199254740992"],
  ["by-infinity", "Infinity"],
  ["variable", "w"],
  ["variable", "w"],
  ["variable", "w"],
  ["variable", "w"],
  ["variable", "w"],
  ["variable", "w"],
  ["variable-int32", "(w | 0)"],
  ["variable-uint32", "(w >>> 0)"],
  ["counter", "i"],
  ["counter-from-below", "(i - 2)"],
  ["counter-above", "(i + 1)"],
  ["power", "(1 << i)"],
  ["length", "list.length"],
  ["outer", "(n + 1)"],
  ["itself", "x"],
];
// `A` is the dividend, `B` the divisor.
const operations: [name: string, text: string][] = [
  ["remainder", "(A) % B"],
  ["quotient", "(A) / B"],
  ["quotient-int32", "(((A) / B) | 0)"],
  ["quotient-uint32", "(((A) / B) >>> 0)"],
  ["quotient-bits", "~~((A) / B)"],
  ["floor", "Math.floor((A) / B)"],
  ["trunc", "Math.trunc((A) / B)"],
  ["ceil", "Math.ceil((A) / B)"],
  ["round", "Math.round((A) / B)"],
  ["remainder-by-hand", "(A) - Math.floor((A) / B) * B"],
  ["remainder-int32", "(((A) % B) | 0)"],
  ["remainder-uint32", "(((A) % B) >>> 0)"],
  ["positive", "(((A) % B) + B) % B"],
  ["absolute", "Math.abs((A) % B)"],
  ["twice", "((A) % B) % 3"],
  ["of-quotient", "Math.floor((A) / B) % 5"],
  ["quotient-of", "((A) % B) / 2"],
  ["times", "((A) % B) * B"],
  ["beside", "((A) % B) + ((A) / B)"],
  ["floor-int32", "(Math.floor((A) / B) | 0)"],
  ["times-dividend", "(A) * ((A) % B)"],
  ["of-difference", "((A) - ((A) % B)) / B"],
];
// `R` is the result.
const uses: [name: string, text: string][] = [
  ["sum", "sum += R;"],
  ["sum-of-bits", "bits = (bits * 31 + (R)) | 0;"],
  ["index", "sum += small[R] ?? 100;"],
  ["index-store", "out[R] = i;"],
  ["view-index", "sum += view[R] ?? 200;"],
  ["view-index-store", "view[R] = i + 1;"],
  ["byte", "bytes[i] = R;"],
  ["double", "doubles[i] = R;"],
  ["int32-element", "view[i] = R;"],
  ["shift-count", "bits ^= 1 << R;"],
  ["shift-right", "bits ^= -7 >>> R;"],
  ["shifted", "bits ^= (R) >> 1;"],
  ["compared", "if (R > 2) sum += 3;"],
  ["is-zero", "if ((R) === 0) sum += 5;"],
  ["negative-zero", "if (Object.is(R, -0)) sum += 7;"],
  ["reciprocal", "notes.push(1 / (R));"],
  ["map-key", "counts.set(R, (counts.get(R) ?? 0) + 1);"],
  ["object-key", "table[R] = (table[R] ?? 0) + 1;"],
  ["field-store", "row.y = R;\nsum += row.y;"],
  ["text", 'text += R + ",";'],
  ["template", "text += `${R};`;"],
  ["character", 'text += "abcdef".charAt(R);'],
  ["character-index", 'text += "abcdef"[R] ?? "-";'],
  ["code", 'sum += "abcdef".charCodeAt(R) | 0;'],
  ["greatest", "sum = Math.max(sum, R);"],
  ["low-bits", "sum += (R) & 7;"],
  ["minus", "notes.push(-(R));"],
  ["pushed", "notes.push(R);"],
  ["switched", "switch (R) {\n  case 0:\n    sum += 1;\n    break;\n  case 2:\n    sum += 20;\n    break;\n  default:\n    sum += 300;\n}"], // prettier-ignore
  ["bound", "for (let j = 0; j < (R) && j < 5; j++) sum += j + 1;"],
  ["sliced", 'text += "abcdef".slice(R, 4);'],
  ["truth", "if (R) sum += 11;\nelse sum += 13;"],
  ["passed", "sum += pass(R);"],
  ["stored", "kept = R;\nsum += kept;"],
  ["list-of", "const pair = [R, i];\nsum += pair[0]! - pair[1]!;"],
  ["literal", "const made = { r: R };\nnotes.push(made.r);"],
];
// `STEP` is the step.
const shapes: [name: string, text: string][] = [
  ["loop", "for (let i = 0; i < 6; i++) {\nSTEP\n}"],
  ["nest", "for (let n = 0; n < 3; n++) {\n  for (let i = 0; i < 5; i++) {\nSTEP\n  }\n}"],
  ["nest-up-to", "for (let n = 0; n < size; n++) {\n  for (let i = n; i < size; i++) {\nSTEP\n  }\n}"],
  ["down", "for (let i = 5; i >= 0; i--) {\nSTEP\n}"],
  ["by-hand", "let i = 0;\nwhile (true) {\n  if (i >= size) break;\nSTEP\n  i++;\n}"],
  ["by-two", "for (let i = 1; i < 9; i += 2) {\nSTEP\n}"],
  ["under-try", "for (let i = 0; i < 6; i++) {\n  try {\nSTEP\n  } catch {\n    sum += 1000;\n  }\n}"],
  ["in-a-try", "try {\n  for (let i = 0; i < size; i++) {\nSTEP\n  }\n} finally {\n  sum += 1;\n}"],
  ["for-each", "list.forEach((_, i) => {\nSTEP\n});"],
  ["of-a-list", "for (const i of [0, 1, 2, 3, 2]) {\nSTEP\n}"],
  ["straight", "const i = size - 3;\nSTEP"],
  ["turned-back", "for (let i = 0; i < 6; i++) {\n  if (i === 2) continue;\nSTEP\n  x = -x;\n}"],
];
// How the numbers come: `CALL` calls with the two numbers.
const givings = [
  "written",
  "parsed",
  "both",
  "inlined-twice",
  "list-of-numbers",
  "two-written",
  "two-written",
  "two-written",
  "three-written",
] as const;
const others = ["3", "-4", "0", "2.5", "16", "2 ** 32", "7", "1"];
const total = bases.length * dividends.length * divisors.length * operations.length * uses.length * shapes.length * givings.length * 2; // prettier-ignore

function write(cell: number): { name: string; text: string } {
  let rest = Number((BigInt(cell) * 829348951n) % BigInt(total));
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const shape = pick(shapes);
  const base = pick(bases);
  const operation = pick(operations);
  const giving = pick(givings);
  const use = pick(uses);
  const divisor = pick(divisors);
  const dividend = pick(dividends);
  const isTyped = rest % 2 === 0;
  const t = (type: string) => (isTyped ? type : "");
  const w = others[cell % others.length];
  const isHelper = cell % 3 === 0;
  const isNamed = cell % 4 === 1;
  const value = operation[1]
    .replaceAll(/\bA\b/g, () => (isNamed ? "y" : dividend[1]))
    .replaceAll(/\bB\b/g, () => divisor[1]);
  const result = isHelper ? `ask(${isNamed ? "y" : dividend[1]}, ${divisor[1]})` : value;
  const step = (isNamed ? `const y = ${dividend[1]};\n` : "") + use[1].replaceAll(/\bR\b/g, () => result);
  const body = (isTyped ? shape[1] : shape[1]).replace("STEP", () => "    " + (isTyped ? step : step.replaceAll(/\]!/g, "]")).replaceAll("\n", "\n    ")); // prettier-ignore
  const parsed = (text: string) => `Number(JSON.parse('"' + (${text}) + '"'))`;
  const calls: Record<(typeof givings)[number], string[]> = {
    "written": [`try {\n  say(run(${base[1]}, ${w}, 6));\n} catch (error) {\n  say(told(error));\n}`],
    "parsed": [
      `try {\n  say(run(${parsed(base[1])}, ${parsed(w)}, ${parsed("6")}));\n} catch (error) {\n  say(told(error));\n}`,
    ],
    "both": [
      `try {\n  say(run(${base[1]}, ${w}, 6));\n} catch (error) {\n  say(told(error));\n}`,
      `try {\n  say(run(${parsed("5")}, ${parsed(w)}, ${parsed("4")}));\n} catch (error) {\n  say(told(error));\n}`,
    ],
    "inlined-twice": [
      `try {\n  say(run(${base[1]}, 3, 5) + run(${base[1]}, ${parsed(w)}, 6));\n} catch (error) {\n  say(told(error));\n}`,
    ],
    // Whole numbers for `x` in every call, and one divisor that is none.
    "two-written": [
      `try {\n  say(run(5, 1.5, 4));\n} catch (error) {\n  say(told(error));\n}`,
      `try {\n  say(run(${base[1]}, ${w}, 6));\n} catch (error) {\n  say(told(error));\n}`,
    ],
    "three-written": [
      `try {\n  say(run(${bases[cell % bases.length][1]}, 2.5, 5));\n} catch (error) {\n  say(told(error));\n}`,
      `try {\n  say(run(${base[1]}, ${w}, 6));\n} catch (error) {\n  say(told(error));\n}`,
      `try {\n  say(run(9, ${parsed("3")}, 6));\n} catch (error) {\n  say(told(error));\n}`,
    ],
    "list-of-numbers": [
      `for (const given of [${base[1]}, 4, ${bases[cell % bases.length][1]}]) try {\n  say(run(given, ${w}, 6));\n} catch (error) {\n  say(told(error));\n}`,
    ],
  };
  const lines = [
    `const notes${t(": number[]")} = [];`,
    `const pass = (value${t(": number")}) => value + 1;`,
    `const ask = (a${t(": number")}, b${t(": number")}) => ${operation[1].replaceAll(/\bA\b/g, "a").replaceAll(/\bB\b/g, "b")};`,
    `function run(x${t(": number")}, w${t(": number")}, size${t(": number")}) {`,
    "  let sum = 0;",
    "  let bits = 0;",
    '  let text = "";',
    "  let kept = 0;",
    "  let at = x;",
    "  const n = 2;",
    `  const list = [x, x + 1, w, 5, x - 2, 7];`,
    "  const row = { x, y: 0 };",
    "  const small = [1, 2, 3, 4, 5];",
    `  const out${t(": number[]")} = [9, 9, 9];`,
    "  const view = new Int32Array(8);",
    "  const bytes = new Uint8Array(8);",
    "  const doubles = new Float64Array(8);",
    `  const counts = new Map${t("<number, number>")}();`,
    `  const table${t(": Record<number, number>")} = {};`,
    ...body.split("\n").map(line => "  " + line),
    '  return [sum, bits, text, kept, at, x, Object.entries(out), [...view], [...bytes], [...doubles], [...counts], Object.entries(table), notes.splice(0).map(note => (Object.is(note, -0) ? "-0" : note))].join(" ");',
    "}",
    `const say = (text${t(": unknown")}) => console.log(text);`,
    `const told = (error${t(": unknown")}) => "!" + ${isTyped ? "(error as Error)" : "error"}.name;`,
    ...calls[giving],
    ...(isTyped ? ["export {};"] : []),
  ]; // prettier-ignore
  return { name: `${base[0]}--${dividend[0]}--${divisor[0]}--${operation[0]}--${use[0]}--${shape[0]}${isTyped ? ".ts" : ".mjs"}`, text: lines.join("\n") + "\n" }; // prettier-ignore
}

const padNumber = (index: number) => String(index).padStart(9, "0");
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
