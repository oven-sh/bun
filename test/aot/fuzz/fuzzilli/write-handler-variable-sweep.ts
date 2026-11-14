// A variable that is written inside a try and read behind it: its values, times where it is written, times what throws, times the handler, times how it is read, times the loop around.
//
//   bun write-handler-variable-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<values>--<writes>--<throw>--<handler>--<read>.ts or .mjs
//   bun write-handler-variable-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

// The first value, the second and the third.
const kinds: [name: string, first: string, second: string, third: string][] = [
  ["layouts", '{ b: "t", c: i & 1 }', "{ a: -0, b: [i, 2] }", "{ c: i }"],
  ["same-layout", "{ a: i, b: 1 }", "{ a: 0.5, b: i }", '{ a: "x", b: 2 }'],
  ["integers", "i", "i + 1", "-1"],
  ["doubles", "i * 0.5", "-0", "NaN"],
  ["integer-double", "i", "i + 0.5", "2 ** 31"],
  ["number-text", "i", '"t" + i', "1.5"],
  ["number-nothing", "i", "undefined", "null"],
  ["object-nothing", "{ a: i, b: 2 }", "null", "undefined"],
  ["object-number", "{ a: i, b: 2 }", "i", '"s"'],
  ["classes", "new Left(i)", "new Right(i)", "new Left(0.5)"],
  ["class-literal", "new Left(i)", "{ a: i }", "null"],
  ["lists", "[i, 1]", "[0.5, i]", "[]"],
  ["list-object", "[i]", "{ a: i, b: 1 }", "i"],
  ["functions", "() => i", "() => -1", "null"],
  ["truths", "i > 1", "true", "false"],
  ["big", "BigInt(i)", "2n", "i"],
];
// `FIRST`, `SECOND` and `THIRD` are the values, `RISK` is what may throw. All of it stands inside the try but the first line.
const writes: [name: string, before: string, inside: string][] = [
  ["behind", "let o = FIRST;", "RISK\no = SECOND;"],
  ["in-front", "let o = FIRST;", "o = SECOND;\nRISK"],
  ["both", "let o = FIRST;", "o = SECOND;\nRISK\no = THIRD;"],
  ["loop-then", "let o = FIRST;", "for (let j = 0; j < n; j++) {\n  RISK\n}\no = SECOND;"],
  ["loop-itself", "let o = FIRST;", "for (let j = 0; j < n; j++) {\n  RISK\n  o = o;\n}\no = SECOND;"],
  ["in-a-loop", "let o = FIRST;", "for (let j = 0; j < n; j++) {\n  RISK\n  o = SECOND;\n}"],
  ["by-turns", "let o = FIRST;", "for (let j = 0; j < n; j++) {\n  o = j & 1 ? SECOND : THIRD;\n  RISK\n}"],
  ["branch", "let o = FIRST;", "if (n > 2) o = SECOND;\nRISK\nif (n > 3) o = THIRD;"],
  ["inner-try", "let o = FIRST;", "try {\n  RISK\n  o = SECOND;\n} finally {\n  done++;\n}"],
  [
    "inner-catch",
    "let o = FIRST;",
    "try {\n  o = SECOND;\n  RISK\n} catch (error) {\n  o = THIRD;\n  if (n & 1) throw error;\n}",
  ],
  ["inner-finally", "let o = FIRST;", "try {\n  RISK\n} finally {\n  o = SECOND;\n}\nRISK"],
  ["later", "let o;", "o = FIRST;\nRISK\no = SECOND;"],
  ["two", "let o = FIRST;\nlet p = SECOND;", "RISK\n[o, p] = [p, o];\nRISK\np = THIRD;"],
  ["captured", "let o = FIRST;\nconst put = value => {\n  o = value;\n};", "RISK\nput(SECOND);\nRISK"],
  ["pattern", "let o = FIRST;", "RISK\n({ o } = { o: SECOND });\nRISK"],
  [
    "nested-loops",
    "let o = FIRST;",
    "for (let j = 0; j < 2; j++) {\n  for (let k = 0; k < n; k++) {\n    RISK\n    if (k === 1) o = SECOND;\n  }\n  o = THIRD;\n}",
  ],
  [
    "continue",
    "let o = FIRST;",
    "for (let j = 0; j < n; j++) {\n  if (j === 1) continue;\n  o = SECOND;\n  RISK\n  if (j > 2) break;\n}",
  ],
];
const risks: [name: string, text: string][] = [
  ["hidden", "hide(o);"],
  ["hidden-throws", "hide(i);"],
  ["by-count", "fail(i);"],
  ["by-calls", "failLater();"],
  ["null-read", "seen += rows[i].a;"],
  ["parse", "seen += JSON.parse(texts[i % texts.length]);"],
  ["own-throw", 'if (i === 2) throw new RangeError("r");'],
  ["call-of-nothing", "seen += asks[i % asks.length]();"],
  ["getter", "seen += gate.value;"],
  ["none", "seen++;"],
  ["text", "seen += String(o).length;"],
];
// `WRITES` is the body of the try.
const handlers: [name: string, text: string][] = [
  ["swallows", "try {\nWRITES\n} catch {}"],
  ["counts", "try {\nWRITES\n} catch {\n  caught++;\n}"],
  ["reads", "try {\nWRITES\n} catch (error) {\n  text += error.name + show(o);\n}"],
  ["replaces", "try {\nWRITES\n} catch {\n  o = THIRD;\n}"],
  ["finally", "try {\nWRITES\n} catch {\n  caught++;\n} finally {\n  text += show(o);\n}"],
  ["finally-writes", "try {\nWRITES\n} catch {\n  o = SECOND;\n} finally {\n  if (i & 1) o = THIRD;\n}"],
  ["leaves", "try {\nWRITES\n} catch {\n  break;\n}"],
  ["goes-on", 'try {\nWRITES\n} catch {\n  text += show(o) + ",";\n  continue;\n}'],
  [
    "throws-on",
    "try {\n  try {\nWRITES\n  } catch (error) {\n    text += show(o);\n    throw error;\n  }\n} catch {\n  caught++;\n}",
  ],
  ["changes", 'try {\nWRITES\n} catch {\n  if (o && typeof o === "object") o.b = 9;\n}'],
];
const reads: [name: string, text: string][] = [
  ["whole", "text += show(o);"],
  ["field", 'text += o?.a ?? "none";'],
  ["two-fields", "text += show([o?.a, o?.b, o?.c]);"],
  ["added", 'sum = sum + (typeof o === "number" ? o : 1);'],
  ["kind", "text += typeof o;"],
  ["element", "text += show(o?.[0]);"],
  ["compared", "if (o > 1) sum++;"],
  ["written-back", 'if (o && typeof o === "object") o.a = i;\ntext += show(o);'],
  ["kept", "kept.push(o);"],
  ["called", 'sum += typeof o === "function" ? o() : 1;'],
];
const rounds: [name: string, text: string][] = [
  ["loop", "for (let i = 0; i < n; i++) {\nTURN\n}"],
  ["of", "for (const i of [0, 1, 2, 3]) {\nTURN\n}"],
  ["while", "let i = -1;\nwhile (++i < n) {\nTURN\n}"],
  ["once", "for (let i = 2; i < 3; i++) {\nTURN\n}"],
];
const total = kinds.length * writes.length * risks.length * handlers.length * reads.length * rounds.length;

function write(cell: number): { name: string; text: string } {
  let rest = cell;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const kind = pick(kinds);
  const written = pick(writes);
  const risk = pick(risks);
  const handler = pick(handlers);
  const read = pick(reads);
  const round = pick(rounds);
  const isTyped = cell % 2 === 1;
  const indent = (text: string, by: string) => text.split("\n").map(line => by + line).join("\n"); // prettier-ignore
  const type = (text: string) => (isTyped ? text : "");
  const turn = [written[1], handler[1].replace("WRITES", () => indent(written[2], "  ")), read[1]].join("\n");
  const body = round[1]
    .replace("TURN", () => indent(turn, "  "))
    .replaceAll("RISK", () => risk[1])
    .replaceAll("FIRST", () => kind[1])
    .replaceAll("SECOND", () => kind[2])
    .replaceAll("THIRD", () => kind[3])
    .replaceAll(/let (o|p) =/g, `let $1${type(": any")} =`)
    .replace("let o;", `let o${type(": any")};`)
    .replaceAll("value =>", `(value${type(": any")}) =>`)
    .replaceAll("catch (error)", `catch (error${type(": any")})`);
  const lines = [
    `class Left {\n${type("  a: any;\n")}  constructor(a${type(": any")}) {\n    this.a = a;\n  }\n}`,
    `class Right {\n${type("  b: any;\n  a: any;\n")}  constructor(a${type(": any")}) {\n    this.b = a;\n    this.a = "r";\n  }\n}`,
    `const show = (value${type(": any")})${type(": string")} => (typeof value === "function" ? "function" : Array.isArray(value) ? "[" + value.map(show).join() + "]" : typeof value === "object" && value ? "{" + Object.keys(value).map(name => name + ":" + show(value[name])).join() + "}" : Object.is(value, -0) ? "-0" : String(value));`,
    "let done = 0;",
    "let seen = 0;",
    "let calls = 0;",
    `const kept${type(": any[]")} = [];`,
    `const rows${type(": any[]")} = [{ a: 1 }, { a: 2 }, null, { a: 3 }];`,
    'const texts = ["1", "2", "{", "4"];',
    `const asks${type(": any[]")} = [() => 1, () => 2, undefined, () => 3];`,
    'const gate = {\n  get value() {\n    if (calls++ % 5 === 3) throw new EvalError("g");\n    return 1;\n  },\n};',
    `const fail = (i${type(": number")}) => {\n  if (i === 1) throw new RangeError("f");\n};`,
    'const failLater = () => {\n  if (calls++ % 4 === 2) throw new SyntaxError("l");\n};',
    `const hide${type(": any")} = [(value${type(": any")}) => {\n  if (value === 2) throw new TypeError("h");\n  return value;\n}][process.argv.length > 9 ? 1 : 0];`,
    `function work(n${type(": number")})${type(": string")} {`,
    '  let text = "";',
    "  let sum = 0;",
    "  let caught = 0;",
    indent(body, "  "),
    '  return [text, sum, caught, seen, done].join("|");',
    "}",
    "for (const n of [4, 1, 0, 7]) {",
    "  try {",
    "    console.log(work(n), kept.splice(0).map(show).join());",
    "  } catch (error) {",
    `    console.log("left", (error${type(" as any")}).name);`,
    "  }",
    "}",
    ...(isTyped ? ["export {};"] : []),
  ]; // prettier-ignore
  return {
    name: `${kind[0]}--${written[0]}--${risk[0]}--${handler[0]}--${read[0]}${isTyped ? ".ts" : ".mjs"}`,
    text: lines.join("\n") + "\n",
  };
}

const padNumber = (index: number) => String(index).padStart(7, "0");
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
