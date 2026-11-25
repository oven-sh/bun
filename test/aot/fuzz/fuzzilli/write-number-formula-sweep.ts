// Random formulas of numbers in a small function that loops call: remainders and quotients alone in every third program, every operator in the others. The formula is an index, a shift count, a key, a sum, a store and more. Numbers lie around 2^31, 2^32 and 2^53, are halves, NaN, infinities and -0.
//
//   bun write-number-formula-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<use>-<shape>.ts or .mjs
import { mkdirSync, writeFileSync } from "node:fs";

const numbers = ["0", "-0", "1", "2", "3", "-3", "5", "7", "-8", "16", "0.5", "-0.5", "1.5", "2.25", "2 ** 31", "2 ** 31 - 1", "-(2 ** 31)", "2 ** 32", "2 ** 32 + 3", "-(2 ** 32) - 1", "2 ** 53", "2 ** 53 - 1", "2 ** 53 + 2", "-(2 ** 53)", "2 ** 52 + 1", "2 ** 51 + 0.5", "1 / 0", "-1 / 0", "0 / 0", "1e300", "5e-324"]; // prettier-ignore
const uses: [name: string, body: string][] = [
  ["index", "return a[F];"],
  ["index-or", "return a[F] ?? 7;"],
  ["index-int32", "return a[(F) | 0];"],
  ["store", "a[F] = x;\n  return a.length;"],
  ["view", "return v[F];"],
  ["view-store", "v[F] = 3;\n  return v[1];"],
  ["view-value", "v[1] = F;\n  return v[1];"],
  ["byte-value", "b[1] = F;\n  return b[1];"],
  ["double-value", "d[1] = F;\n  return d[1];"],
  ["value", "return F;"],
  ["shift", "return 1 << (F);"],
  ["shifted", "return (F) >>> 1;"],
  ["bits", "return (F) | 0;"],
  ["compared", "return (F) < x ? 1 : 2;"],
  ["equal", "return (F) === 0 ? 1 : 2;"],
  ["zero", "return 1 / (F);"],
  ["text", 'return "" + (F);'],
  ["character", 'return "abcdef".charCodeAt(F);'],
  ["key", "return (m.get(F) ?? 0) + (m.set(F, 1).size & 7);"],
  ["field", "r.f = F;\n  return r.f;"],
  ["named", "const z = F;\n  return z * 2 + z;"],
  ["twice", "return (F) + (F);"],
  ["bound", "let s = 0;\n  for (let k = 0; k < (F) && k < 4; k++) s += k + y;\n  return s;"],
  ["caught", "try {\n    return a[F]!.toFixed(1);\n  } catch {\n    return -1;\n  }"],
  ["chosen", "return (F) ? x : w;"],
  ["floor", "return Math.floor(F);"],
  ["greatest", "return Math.max(F, w);"],
];
// `CALL` is the call of the small function with `x`, `Y` and `w`.
const shapes: [name: string, text: string][] = [
  ["nest", "for (let j = 0; j < 2; j++) {\n  for (let i = 0; i < 4; i++) {\n    say(CALL);\n  }\n}"],
  ["loop", "for (let i = 0; i < 5; i++) say(CALL);"],
  ["copied", "for (let i = 0; i < 3; i++) {\n  say(CALL);\n  say(CALL);\n}"],
  ["summed", "let s: any = 0;\nfor (let i = 0; i < 6; i++) s += CALL;\nsay(s);"],
  ["carried", "let i = 0;\nlet at: any = y;\nwhile (i < 5) {\n  y = at;\n  at = CALL;\n  say(at);\n  i++;\n}"],
  ["down", "for (let i = 4; i >= 0; i--) say(CALL);"],
  ["up-to", "for (let j = 0; j < 3; j++) for (let i = j; i < 3; i++) say(CALL);"],
  ["tried", "try {\n  for (let i = 0; i < 4; i++) say(CALL);\n} finally {\n  say(7);\n}"],
  ["straight", "const i = 1;\nsay(CALL);"],
];
const second = ["y + i", "y - i", "y", "i", "y * i", "y + i * 2", "-y - i", "(y + i) | 0"];

function write(cell: number): { name: string; text: string } {
  let state = (cell * 2654435761 + 12345) >>> 0;
  const random = (below: number) => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state % below;
  };
  for (let warm = 0; warm < 5; warm++) random(2);
  const from = <T>(list: readonly T[]): T => list[random(list.length)]!;
  const hasEveryOperator = cell % 3 !== 0;
  let divisions = 0;
  function formula(depth: number): string {
    if (depth === 0 || (depth < 3 && random(5) === 0)) return random(6) === 0 ? "(" + from(numbers.slice(0, 16)) + ")" : from(["x", "y", "w", "y"]); // prettier-ignore
    const left = () => formula(depth - 1);
    if (hasEveryOperator && random(3)) {
      divisions++;
      const pick = random(22);
      if (pick < 8) return `(${left()} ${["&", "|", "^", "<<", ">>", ">>>", "**", "-"][pick]} ${left()})`;
      if (pick < 18) return `Math.${["floor", "ceil", "round", "trunc", "abs", "sqrt", "sign", "clz32", "fround", "cbrt"][pick - 8]}(${left()})`; // prettier-ignore
      if (pick < 21) return `Math.${["min", "max", "imul"][pick - 18]}(${left()}, ${left()})`;
      return `(${left()} ${from(["<", "<=", "===", ">", "!=="])} ${left()} ? ${left()} : ${left()})`;
    }
    switch (random(14)) {
      case 0:
      case 1:
      case 2:
      case 3:
        divisions++;
        return `(${left()} % ${left()})`;
      case 4:
        divisions++;
        return `(${left()} / ${left()})`;
      case 5:
        divisions++;
        return `Math.floor(${left()} / ${left()})`;
      case 6:
      case 7:
        return `(${left()} * ${left()})`;
      case 8:
      case 9:
        return `(${left()} + ${left()})`;
      case 10:
        return `(${left()} - ${left()})`;
      case 11:
        return `(${left()} | 0)`;
      case 12:
        return `(${left()} >>> 0)`;
      default:
        return `(-${left()})`;
    }
  }
  let text = "x";
  for (let attempt = 0; attempt < 20 && !divisions; attempt++) text = formula(2 + random(2));
  const use = uses[cell % uses.length]!;
  const shape = from(shapes);
  const isTyped = random(2) === 0;
  const t = (type: string) => (isTyped ? type : "");
  const strip = (code: string) => (isTyped ? code : code.replaceAll(": any", "").replaceAll("]!", "]"));
  const call = () => `get(a, x, ${from(second)}, w)`;
  // In every other program the second number is whole in every call, and often at 2^53.
  const isWhole = cell % 2 === 1;
  const isWholeEverywhere = cell % 5 === 1;
  const whole = ["5", "2 ** 53", "2 ** 53", "2 ** 53 - 1", "2 ** 32", "2 ** 31", "9", "0", "2 ** 52"];
  const quadruple = () =>
    isWhole
      ? `${from(isWholeEverywhere ? whole : numbers)}, ${from(whole)}, ${from(numbers)}`
      : `${from(numbers)}, ${from(numbers)}, ${from(numbers)}`;
  const parsed = () => [from(numbers), from(numbers), from(numbers)].map(number => `Number(JSON.parse('"' + (${number}) + '"'))`).join(", "); // prettier-ignore
  const ways = cell % 4 === 1 ? [quadruple] : [quadruple, quadruple, parsed];
  const lines = [
    `const list${t(": number[]")} = [];`,
    `for (let i = 0; i < 16; i++) list.push(((i * 7) % 13) / ${from(["1", "1", "4"])});`,
    "const v = new Int32Array(8);",
    "const b = new Uint8Array(4);",
    "const d = new Float64Array(4);",
    `const m = new Map${t("<number, number>")}();`,
    "const r = { f: 0 };",
    `const said${t(": string[]")} = [];`,
    `const say = (value${t(": any")}) => void said.push(Object.is(value, -0) ? "-0" : String(value));`,
    `function get(a${t(": number[]")}, x${t(": number")}, y${t(": number")}, w${t(": number")})${t(": any")} {`,
    `  ${strip(use[1].replaceAll(/\bF\b/g, () => text))}`,
    "}",
    `function run(a${t(": number[]")}, x${t(": number")}, y${t(": number")}, w${t(": number")}) {`,
    ...strip(shape[1].replaceAll("CALL", call)).split("\n").map(line => "  " + line), // prettier-ignore
    "}",
    ...Array.from({ length: 2 + random(3) }, () => `try {\n  run(list, ${from(ways)()});\n} catch (error) {\n  say(${isTyped ? "(error as Error)" : "error"}.name);\n}`), // prettier-ignore
    'console.log(said.join(" "), list.length, list.slice(0, 20).join(), v.join(), b.join(), d.join(), Object.keys(list).length);',
    ...(isTyped ? ["export {};"] : []),
  ]; // prettier-ignore
  return { name: `${use[0]}-${shape[0]}${isTyped ? ".ts" : ".mjs"}`, text: lines.join("\n") + "\n" };
}

const padNumber = (index: number) => String(index).padStart(9, "0");
const [folder, from, count, stride] = [process.argv[2], Number(process.argv[3] ?? 0), Number(process.argv[4] ?? 100), Number(process.argv[5] ?? 1)]; // prettier-ignore
mkdirSync(folder, { recursive: true });
for (let step = 0; step < count; step++) {
  const index = from + step * stride;
  const program = write(index);
  writeFileSync(`${folder}/${padNumber(index)}-${program.name}`, program.text);
}
console.log(count);
