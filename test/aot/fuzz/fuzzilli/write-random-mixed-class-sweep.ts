// Classes whose members are drawn, and functions of statements of all kinds over their instances: members read, stored, called, added, laid anew, taken away, prototypes exchanged, instances copied, asked and listed.
//
//   bun write-random-mixed-class-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<seed>-<classes>-<statements>.mjs, .cjs or .ts
import { mkdirSync, writeFileSync } from "node:fs";

const names = ["x", "y", "z", "run", "size", "half"];
// `K` is a name, `C` a class, `O` and `P` instances, `F` a function.
const statements = [
  "t += show(O.K);",
  "O.K = i;",
  "O.K = i + 0.5;",
  "O.K = 's' + i;",
  "O.K = P;",
  "O.K = undefined;",
  "O.x += 1;",
  "O.K ??= i;",
  "t += show(O.K?.(i));",
  "t += show(O.run(i));",
  "t += show(O.size(P));",
  "t += show(O.run?.(O.x, i));",
  "t += show(O[key]);",
  "O[key] = i;",
  "t += show(O[key]?.(i));",
  "key = one(i);",
  "t += show(O.run.call(P, i));",
  "t += show(O.run.apply(P, [i, 2]));",
  "t += show(O.size.bind(P)(i));",
  "const taken = O.run;\nt += show(taken.call(O, i));",
  "const { K: first, x: second = 4 } = O;\nt += show(first) + show(second);",
  "delete O.K;",
  "delete C.prototype.K;",
  "C.prototype.K = i;",
  "C.prototype.run = function (value) {\n  return this.x + 10;\n};",
  "C.prototype.size = value => value;",
  "Object.defineProperty(C.prototype, 'K', { configurable: true, get() {\n  return 'g' + i;\n}, set(value) {\n  this.kept = value;\n} });",
  "Object.defineProperty(O, 'K', { configurable: true, enumerable: true, get: () => i });",
  "Object.defineProperty(O, 'K', { value: i, writable: true, configurable: true });",
  "Object.setPrototypeOf(O, C.prototype);",
  "Object.setPrototypeOf(C.prototype, null);",
  "Object.freeze(O);",
  "Object.seal(P);",
  "O = new C(i);",
  "O = new C();",
  "O = new C(i, P);",
  "O = i % 2 ? new C(i) : new C(0.5);",
  "O = i % 3 ? new C(i) : { x: 1, run: () => 2, size: () => 3 };",
  "O = Object.create(P);",
  "O = { ...P };",
  "O = Object.assign(new C(1), P);",
  "O = P;",
  "O = Reflect.construct(C, [i], C2);",
  "O = new O.constructor(i);",
  "O = C.made(i);",
  "O = { __proto__: P, x: i };",
  "for (const name in O) t += name;",
  "t += Object.keys(O).join();",
  "t += Object.getOwnPropertyNames(O).length;",
  "t += JSON.stringify(O)?.slice(0, 30);",
  "t += 'K' in O;",
  "t += Object.hasOwn(O, 'K');",
  "t += O instanceof C;",
  "t += O.constructor === C;",
  "t += Object.getPrototypeOf(O) === C.prototype;",
  "t += C.count++;",
  "C.count = i;",
  "t += show(C.K);",
  "t += show(C2.count);",
  "t += typeof O.K;",
  "if (typeof O.x === 'number') sum += O.x;",
  "sum += O.x * 2;",
  "sum = (sum + (O.y | 0)) | 0;",
  "sum += +O.half || 1;",
  "O.half = i;",
  "O.x++;",
  "O.y = O.x;",
  "[O, P] = [P, O];",
  "list.push(O);",
  "t += show(list[i % list.length].K);",
  "t += show(list[i % list.length].run(i));",
  "for (const item of list) sum += +item.x || 0;",
  "for (const item of list) t += show(item.size?.(i)).slice(0, 4);",
  "list.forEach(item => (item.K = i));",
  "if (list.length > 5) list.length = 2;",
  "t += show(list.map(item => item.x).join());",
  "t += show(work(O, i));",
  "t += show(hand(O)?.K);",
  "t += show(O == P);",
  "t += typeof String(O);",
  "t += show(O + '');",
  "const copy = structuredCopy(O);\nt += show(copy.K);",
  "const read = () => O.K;\nt += show(read());",
  "withValue(O, value => (sum += +value || 0));",
  "t += show(Reflect.get(C.prototype, 'K', O));",
  "t += show(Reflect.set(O, 'K', i));",
  "t += show(Reflect.ownKeys(O).length);",
  "t += show(new Proxy(O, {}).K);",
  "t += show(C.prototype.hasOwnProperty('K'));",
];
const nests = [
  "for (let j = 0; j < 3; j++) {\n  S\n}",
  "for (let O of list.slice(0, 3)) {\n  S\n}",
  "if (O instanceof C) {\n  S\n} else {\n  S\n}",
  "if (typeof O.K === 'function') {\n  S\n}",
  "if (i & 1) {\n  S\n}",
  "try {\n  S\n} catch (error) {\n  t += error.name[0];\n}",
  "try {\n  S\n} finally {\n  sum++;\n}",
  "switch (O.constructor) {\n  case C:\n    S\n    break;\n  default:\n    S\n}",
  "const part = () => {\n  S\n};\npart();",
  "[0, 1].forEach(i => {\n  S\n});",
  "{\n  let O = new C(i);\n  S\n}",
];

function write(seed: number): { name: string; text: string } {
  let state = (seed * 2654435761 + 777) >>> 0 || 1;
  const random = (below: number): number => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state % below;
  };
  for (let turn = 0; turn < 8; turn++) random(2);
  const pick = <T>(from: readonly T[]): T => from[random(from.length)];
  const indent = (text: string, by: string) => text.split("\n").map(line => by + line).join("\n"); // prettier-ignore
  const isTyped = seed % 4 === 1;
  const isCommon = !isTyped && seed % 5 === 0;
  const classes = ["A", "B", "D"].slice(0, 1 + random(3));
  const texts: string[] = [];
  const bodies = ["return this.x + v;", "this.x += v;\nreturn this.x;", "return v;", "return this;", "return [this.x, v].join('');", "return this.size?.name ?? v;", "return v > 1 ? this.y : -v;", "this.late = v;\nreturn this.late;", "return arguments.length + +v;", "let sum = 0;\nfor (let k = 0; k < 4; k++) sum += this.x + k;\nreturn sum;", "return new this.constructor(v).x;", "return this.half;", "if (v === 2) throw new RangeError('m');\nreturn 1;", "return `${this.y}${v}`;"]; // prettier-ignore
  classes.forEach((name, at) => {
    const parent = at && random(3) ? pick(classes.slice(0, at)) : random(9) === 0 ? "Array" : "";
    const isFunction = !parent && random(4) === 0;
    const members: string[] = [];
    const fields = names.slice(0, 3).filter(() => random(2));
    const values = ["1", "0.5", "'f'", "undefined", "null", "[]", "v", "{ v: 1 }"];
    if (isFunction) {
      texts.push(`function ${name}(v) {\n${fields.map(field => `  this.${field} = ${pick(values)};`).join("\n")}\n}`);
      texts.push(`${name}.count = 0;`);
      texts.push(`${name}.made = v => new ${name}(v);`);
      for (const method of ["run", "size"]) if (random(6)) texts.push(`${name}.prototype.${method} = function (v) {\n${indent(pick(bodies), "  ")}\n};`); // prettier-ignore
      if (random(2)) texts.push(`Object.defineProperty(${name}.prototype, "half", { configurable: true, get() { return this.x / 2; }, set(v) { this.x = v; } });`); // prettier-ignore
      return;
    }
    for (const field of fields) if (random(2)) members.push(`${field} = ${pick(values).replace(/\bv\b(?!:)/, "2")};`);
    members.push("static count = 0;", `static made(v) {\n  return new ${random(2) ? "this" : name}(v);\n}`);
    if (random(3)) members.push(`constructor(v${random(2) ? " = 3" : ""}) {\n${parent ? `  super(${random(2) ? "v" : ""});\n` : ""}${fields.map(field => `  this.${field} = ${pick(values)};\n`).join("")}${random(3) === 0 ? "  if (v === 1) return { x: 7, run: () => 1, size: () => 2 };\n" : ""}}`); // prettier-ignore
    for (const method of ["run", "size"])
      if (random(6)) members.push(`${random(7) === 0 ? "static " : ""}${method}(v) {\n${indent(parent && random(3) === 0 ? `return super.${method}?.(v) ?? v;` : pick(bodies), "  ")}\n}`); // prettier-ignore
    if (random(2)) members.push("get half() {\n  return this.x / 2;\n}", "set half(v) {\n  this.x = v;\n}");
    if (random(6) === 0) members.push("#own = 1;", "own(v) {\n  this.#own += v;\n  return this.#own;\n}");
    if (random(6) === 0) members.push("run = v => this.x + v;");
    if (random(8) === 0) members.push("toString() {\n  return 'T' + this.x;\n}");
    if (random(8) === 0) members.push("valueOf() {\n  return 5;\n}");
    texts.push(
      `class ${name}${parent ? ` extends ${parent}` : ""} {\n${members.map(member => indent(member, "  ")).join("\n")}\n}`,
    );
  });
  let count = 0;
  const fill = (text: string) => text.replaceAll(/\b(C2|[CKOP])\b/g, letter => (letter === "C" || letter === "C2" ? pick(classes) : letter === "K" ? pick(names) : letter === "O" ? "o" : "p")); // prettier-ignore
  const draw = (depth: number, most: number): string => {
    const parts: string[] = [];
    for (let at = 1 + random(most); at > 0; at--) {
      count++;
      if (depth < 3 && random(5) === 0)
        parts.push(
          `{\n${indent(
            fill(pick(nests)).replaceAll(/^( *)S$/gm, (_, by) => indent(draw(depth + 1, 3), by)),
            "  ",
          )}\n}`,
        );
      else {
        const text = fill(pick(statements));
        // What may throw stands under a handler, but not always.
        const isCaught = random(3) === 0;
        parts.push(isCaught ? `try {\n${indent(text, "  ")}\n} catch (error) {\n  t += error.name[0];\n}` : /^const /m.test(text) ? `{\n${indent(text, "  ")}\n}` : text); // prettier-ignore
      }
    }
    return parts.join("\n");
  };
  const loop = pick(["for (let i = 0; i < 5; i++) {\n  S\n}", "for (const i of [0, 1, 2, 3]) {\n  S\n}", "[0, 1, 2].forEach(i => {\n  S\n});", "let i = 4;\nwhile (i-- > 0) {\n  S\n}", "const i = 1;\nS", "for (let i = 0; i < 30; i++) {\n  S\n}"]); // prettier-ignore
  const body = loop.replaceAll(/^( *)S$/gm, (_, by) => indent(draw(0, 10), by));
  const first = pick(classes);
  const second = pick(classes);
  const lines = [
    ...(isTyped ? ["// @ts-nocheck"] : []),
    ...(isCommon && seed % 2 ? ['"use strict";'] : []),
    'const show = value => (typeof value === "function" ? "f" : Array.isArray(value) ? "[" + value.length + "]" : typeof value === "object" && value ? "(" + Object.keys(value) + ")" : Object.is(value, -0) ? "-0" : /=>|function|\\) \\{/.test(String(value)) ? "code" : String(value).slice(0, 24));',
    "const out = [];",
    ...texts,
    ...(/\bone\(/.test(body) ? ['const one = i => ["x", "y", "run", "z"][i & 3];'] : []),
    ...(/\bwork\(/.test(body) ? ["function work(given, i) {\n  let sum = 0;\n  for (let k = 0; k < 3; k++) sum += +given.x || k;\n  return sum + i;\n}"] : []), // prettier-ignore
    ...(/\bhand\(/.test(body) ? ["const hand = value => value;"] : []),
    ...(/\bstructuredCopy\(/.test(body) ? ["const structuredCopy = value => Object.assign(Object.create(Object.getPrototypeOf(value)), value);"] : []), // prettier-ignore
    ...(/\bwithValue\(/.test(body) ? ["const withValue = (value, then) => then(value.x);"] : []),
    "function run(n) {",
    "  let t = '';",
    "  let sum = 0;",
    `  let o = new ${first}(n);`,
    `  let p = new ${second}(0.5);`,
    ...(/\bkey\b/.test(body) ? ["  let key = 'x';"] : []),
    ...(/\blist\b/.test(body) ? [`  const list = [o, p, new ${pick(classes)}(2)];`] : []),
    "  try {",
    indent(body, "    "),
    "  } finally {",
    "    out.push(t.slice(0, 500), show(sum), show(o), show(p));",
    "  }",
    "}",
    "for (const n of [3, 'n']) {",
    "  try {",
    "    run(n);",
    "  } catch (error) {",
    "    out.push(error.name);",
    "  }",
    "}",
    'console.log(out.join("\\n").slice(0, 3000));',
    ...(isTyped ? ["export {};"] : []),
  ];
  return {
    name: `${classes.length}-${count}.${isTyped ? "ts" : isCommon ? "cjs" : "mjs"}`,
    text: lines.join("\n") + "\n",
  };
}

const padNumber = (index: number) => String(index).padStart(7, "0");
const [folder, from, count, stride] = [process.argv[2], Number(process.argv[3] ?? 0), Number(process.argv[4] ?? 100), Number(process.argv[5] ?? 1)]; // prettier-ignore
mkdirSync(folder, { recursive: true });
for (let step = 0; step < count; step++) {
  const seed = from + step * stride;
  const program = write(seed);
  writeFileSync(`${folder}/${padNumber(seed)}-${program.name}`, program.text);
}
console.log(count);
