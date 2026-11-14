// Generates random programs on remainders of sums, differences, products and plain values around 2^31, 2^32, 2^52 and 2^53: divisors are constant or variable, zero, negative, fractional, powers of two, edges.
// The remainder is a number, a key, a text, bits, a test, an argument, stored into views, in short and long loops, unrolled, nested, copied, carried. Each function is called with numbers that the build sees, the first mostly ordinary. The program number is the random seed.
//
//   bun write-random-remainder-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<functions>-functions.mjs or .ts
//   bun write-random-remainder-sweep.ts count
import { Draws, writePrograms } from "./draw-by-seed.ts";

const wide = ["2 ** 53", "2 ** 53 - 1", "2 ** 53 - 2", "2 ** 53 - 3", "2 ** 53 + 2", "2 ** 53 + 4", "2 ** 54", "2 ** 52", "2 ** 52 + 1", "2 ** 52 + 0.5", "-(2 ** 53)", "-(2 ** 53) + 1", "2 ** 31", "2 ** 31 - 1", "2 ** 31 - 2", "-(2 ** 31)", "-(2 ** 31) + 1", "2 ** 32", "2 ** 32 - 1", "2 ** 32 - 2", "2 ** 30", "2 ** 63", "2 ** 64", "1e21", "9007199254740991", "2 ** 51", "2 ** 26 * 2 ** 27", "3 * 2 ** 51", "2 ** 53 - 5", "2 ** 33", "Infinity", "NaN", "-0", "0.5", "2 ** 1000"]; // prettier-ignore
const ordinary = ["5", "7", "0", "1", "2", "3", "10", "12", "100", "1.5", "-4", "33", "255"]; // prettier-ignore
const divisors = ["3", "3", "5", "7", "2", "10", "1.5", "0.5", "-3", "-1", "1", "0", "4", "8", "16", "1000", "2 ** 31", "2 ** 32", "2 ** 53", "2 ** 53 - 1", "-0", "NaN", "Infinity", "2.5", "6", "9", "11", "1e-3", "2 ** 31 - 1", "65536"]; // prettier-ignore
const dividends = ["y + i", "y + i", "y + i", "y - i", "i - y", "y * i", "y + 1", "y - 1", "y * 2 + i", "y + i + z", "y * (i + 1)", "y", "y + i * 3", "(y + i) + (z - i)", "y + z", "y - z", "y * z + i", "y + (i & 1)", "y + i / 1", "y + 2 * i", "i + y", "-y + i", "y + i - 1", "z + i"]; // prettier-ignore

// `M` is the remainder, `X` its dividend and `D` its divisor.
const uses = [
  "s += M;", "s = s * 10 + M;", "s = (s * 10 + M) % 1e9;", "o.push(M);", "o.push(M);", "o.push(list[M]);", "o.push(list[(M) | 0]);", 'o.push("" + M);', "o.push(`${M}`);", "o.push((M) | 0);", "o.push((M) >>> 0);", "o.push((M) & 3);", "if (M === 0) s++;", "if ((M) < 1) s += 2;\nelse s += 3;", "if ((M) == 1) o.push(i);", "o.push(call(M));", "s = s + (M > 0 ? 1 : 0);", "view[i & 3] = M;\no.push(view[i & 3]);", "bytes[0] = M;\no.push(bytes[0]);", "o.push(-(M));", "o.push((M) + 0.5);", "o.push(((M) + (D)) % (D));", "o.push(Object.is(M, -0));", "o.push((M) * 2);", "o.push(1 / (M));", "o.push(Math.floor(M));", 'switch (M) {\n  case 0:\n    o.push("z");\n    break;\n  case 1:\n    o.push("one");\n    break;\n  default:\n    o.push("d");\n}', "map[M] = i;\no.push(Object.keys(map).length);", "o.push((M) === ((X) % (D)));", "o.push(names[M]);", "o.push(text[M], text.charCodeAt(M));", 'if (!(M)) o.push("no");',
]; // prettier-ignore
// `N` is how many turns, `U` the use.
const loops = [
  ...Array.from({ length: 5 }, () => "for (let i = 0; i < N; i++) {\nU\n}"),
  "for (let i = N; i > 0; i--) {\nU\n}", "for (let j = 0; j < 2; j++) for (let i = 0; i < N; i++) {\nU\n}", "for (let i = 0; i < N; i++) {\nU\ny++;\n}", "for (let i = 0; i < N; i++) {\nU\ny += 2;\n}", "for (let i = 0; i < N; i++) {\nU\nz = y % 7;\n}", "for (let i = 0; i < N; i++) {\nU\n}\nfor (let i = 0; i < 2; i++) {\nU\n}", "let i = 0;\nwhile (i < N) {\nU\ni++;\n}", "for (let i = 0; i < N; i += 0.5) {\nU\n}", "const i = 1;\nU", "for (const i of [0, 1, 2]) {\nU\n}", "for (let i = 0; i < n; i++) {\nU\n}", "for (let i = 0; i < N; i++) {\nif (i > 0) {\nU\n}\n}",
]; // prettier-ignore

function write(seed: number): { name: string; text: string } {
  const draws = new Draws(seed);
  const { next, pick } = draws;
  const isTyped = next() < 0.75;
  const typed = (type: string) => (isTyped ? ": " + type : "");
  function writeFunction(at: number): { text: string; calls: string[] } {
    const dividend = pick(dividends);
    const drawn = next();
    const divisor = drawn < 0.6 ? "w" : drawn < 0.9 ? pick(divisors) : "w + i";
    const remainder = /^[\w.]+$/.test(divisor) ? `(${dividend}) % ${divisor}` : `(${dividend}) % (${divisor})`;
    const use = pick(uses).replaceAll(/\bM\b/g, () => remainder).replaceAll(/\bX\b/g, () => dividend).replaceAll(/\bD\b/g, () => divisor); // prettier-ignore
    const turns = pick([1, 2, 2, 2, 3, 3, 4, 5, 8, 20]);
    const loop = pick(loops).replaceAll(/\bN\b/g, String(turns)).replaceAll(/\bU\b/g, () => use); // prettier-ignore
    const parameters = `y${typed("number")}, w${typed("number")}, z${typed("number")}, n${typed("number")}`;
    const before = `let s = 0;\n  const o${typed("any[]")} = [], map${typed("any")} = {};`;
    const behind = `return o.map(show).join() + "|" + show(s);`;
    const inside = `${before}\n  ${loop}\n  ${behind}`;
    const name = "h" + at;
    const form = next();
    let text: string;
    if (form < 0.5) text = `function ${name}(${parameters})${typed("string")} {\n  ${inside}\n}`;
    else if (form < 0.62) text = `const ${name} = (${parameters})${typed("string")} => {\n  ${inside}\n};`;
    else if (form < 0.74)
      text = `function inner${at}(${parameters})${typed("string")} {\n  ${inside}\n}\nfunction ${name}(${parameters})${typed("string")} {\n  let all = "";\n  for (let q = 0; q < 2; q++) all += inner${at}(y + q, w, z, n) + ";";\n  return all;\n}`;
    else if (form < 0.84)
      text = `class C${at} {\n${isTyped ? "  y: number;\n" : ""}  constructor(y${typed("number")}) {\n    this.y = y;\n  }\n  go(w${typed("number")}, z${typed("number")}, n${typed("number")})${typed("string")} {\n  let y = this.y;\n  ${inside}\n  }\n}\nconst ${name} = (${parameters}) => new C${at}(y).go(w, z, n);`;
    else if (form < 0.92)
      text = `function rem${at}(a${typed("number")}, w${typed("number")}, i${typed("number")})${typed("number")} {\n  return a % ${pick(["w", "w", "3", "8"])};\n}\nfunction ${name}(${parameters})${typed("string")} {\n  ${before}\n  for (let i = 0; i < ${Math.min(turns, 5)}; i++) o.push(rem${at}(${dividend}, w, i));\n  ${behind}\n}`;
    else
      text = `function* g${at}(${parameters})${typed("any")} {\n  ${before}\n  ${loop}\n  yield show(s);\n  yield* o;\n}\nconst ${name} = (${parameters}) => [...g${at}(y, w, z, n)].map(show).join();`;
    const calls: [string, string, string][] = next() < 0.8 ? [[next() < 0.75 ? pick(ordinary) : pick(wide), pick(divisors), pick([...ordinary, ...wide.slice(0, 8)])]] : []; // prettier-ignore
    for (let more = pick([1, 1, 2]); more > 0; more--) calls.push([pick(wide), pick(divisors), next() < 0.6 ? pick(ordinary) : pick(wide)]); // prettier-ignore
    const hidden = next();
    return {
      text,
      calls: calls.map(([y, w, z]) => `say("${at}", () => ${name}(${hidden < 0.2 ? `hide(${y})` : y}, ${hidden < 0.12 ? `hide(${w})` : w}, ${z}, ${pick(["2", "3", "4", "1"])}));`), // prettier-ignore
    };
  }
  const functions = draws.several(4, writeFunction);
  const lines = [
    `const list${typed("any[]")} = [10, 20.5, 30, 40, 50, 60, 70], view = new Int32Array(4), bytes = new Uint8Array(1), names${typed("string[]")} = ["a", "b", "c", "d"], text = "abcdefgh";`,
    `const call = (v${typed("number")})${typed("number")} => v + 1;`,
    `const show = (v${typed("any")})${typed("string")} => (Object.is(v, -0) ? "-0" : String(v));`,
    `const hide = (v${typed("number")})${typed("number")} => (process.argv.length > 99 ? 0 : Number(show(v)));`,
    `const lines${typed("string[]")} = [];`,
    `const say = (name${typed("string")}, ask${typed("() => any")}) => {\n  let v${typed("any")};\n  try {\n    v = ask();\n  } catch (error${typed("any")}) {\n    v = "!" + error.name;\n  }\n  lines.push(name + " " + v);\n};`,
    ...functions.map(one => one.text),
    ...functions.flatMap(one => one.calls),
    'console.log(lines.join("\\n"));',
    ...(isTyped ? ["export {};"] : []),
  ]; // prettier-ignore
  return { name: `${functions.length}-functions.${isTyped ? "ts" : "mjs"}`, text: lines.join("\n") + "\n" };
}

writePrograms(8_000_000, write);
