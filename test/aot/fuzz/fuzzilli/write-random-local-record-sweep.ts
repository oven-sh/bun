// Generates random programs on records, pairs and lists that a function makes for itself: they are changed, exchanged, copied and joined over branches, switches, loops, handlers and closures, returned by small functions, and seldom leave the function. The program number is the random seed.
//
//   bun write-random-local-record-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<statements>.mjs
//   bun write-random-local-record-sweep.ts count
import { Draws, writePrograms } from "./draw-by-seed.ts";

function write(seed: number): { name: string; text: string } {
  const draws = new Draws(seed);
  const { next, pick, between, chance } = draws;
  let statements = 0;
  let names = 0;
  const record = () => pick(["p", "p", "q", "r"]);
  const field = () => pick(["a", "a", "b", "c"]);
  const place = () => pick([`${record()}.${field()}`, `${record()}.${field()}`, `${record()}.${field()}`, "pair[0]", "pair[1]", "list[0]", "list[1]", "point.x", "point.y", `${record()}.in.d`]); // prettier-ignore
  const scalar = () =>
    pick(["v", "w", "i0", "k", String(between(0, 5)), "0.5", "hidden", "given[2]", "given[k & 3]", "-1", "v | 0"]);
  const value = (depth = 2): string => {
    if (depth <= 0) return chance(0.5) ? scalar() : place();
    switch (between(0, 11)) {
      case 0:
      case 1:
        return place();
      case 2:
        return scalar();
      case 3:
      case 4:
        return `${value(depth - 1)} + ${value(depth - 1)}`;
      case 5:
        return `(${value(depth - 1)}) - ${place()}`;
      case 6:
        return `(${test()} ? ${value(depth - 1)} : ${value(depth - 1)})`;
      case 7:
        return `sum(${pick(["p", "q", "pair", "point"])})`;
      case 8:
        return `(${place()} | 0)`;
      case 9:
        return `make(${scalar()}).a`;
      case 10:
        return `pick(${scalar()})[0]`;
      default:
        return `(${place()} === ${place()} ? 1 : 2)`;
    }
  };
  const test = (): string => pick([`${scalar()} > ${scalar()}`, `${place()} === ${place()}`, `v === ${between(0, 4)}`, `${place()} > 2`, "k & 1", "flag", `${record()} === ${record()}`, `typeof ${place()} === "number"`]); // prettier-ignore
  const literal = (): string => {
    const x = () => value(1);
    return pick([
      () => `{ a: ${x()}, b: ${x()}, c: ${x()}, in: { d: ${x()} } }`,
      () => `{ a: ${x()}, b: ${x()}, c: ${x()}, in: { d: ${x()} } }`,
      () => `{ c: ${x()}, b: ${x()}, a: ${x()}, in: { d: 1 } }`,
      () => `{ ...${record()}, ${field()}: ${x()} }`,
      () => `make(${scalar()})`,
      () => `new Item(${x()}, ${x()})`,
      () => `{ a: ${x()}, b: [${x()}], c: 2, in: p.in }`,
    ])();
  };
  const indent = (text: string) => text.split("\n").map(line => "  " + line).join("\n"); // prettier-ignore
  function block(depth: number, inLoop: boolean): string {
    return indent(draws.several(between(1, 3), () => statement(depth, inLoop)).join("\n"));
  }
  function statement(depth: number, inLoop: boolean): string {
    statements++;
    const kind = depth <= 0 || statements > 45 ? between(0, 9) : between(0, 19);
    switch (kind) {
      case 0:
      case 1:
        return `${place()} = ${value()};`;
      case 2:
        return `${place()} += ${value(1)};`;
      case 3:
        return `${record()} = ${literal()};`;
      case 4:
        return `${record()} = ${record()};`;
      case 5:
        return pick(["[p, q] = [q, p];", "[pair[0], pair[1]] = [pair[1], pair[0]];", "[p.a, p.b] = [p.b, p.a];", "pair = [p.a, q.b];", "point = { x: p.a, y: pair[0] };", "list = [pair[0], point.x, v];", "({ a: v, b: w } = p);", "[v, w] = pair;", "pair = [...pair].reverse();"]); // prettier-ignore
      case 6:
        return `${pick(["v", "w"])} = ${value()};`;
      case 7:
        return chance(0.5) ? `total += ${value()};` : `note(${value()});`;
      case 8:
        return inLoop && chance(0.3) ? `if (${test()}) ${pick(["break;", "continue;"])}` : `flag = ${test()};`;
      case 9:
        return chance(0.2) ? `kept.push(${record()});` : `note(${place()});`;
      case 10:
      case 11:
        return `if (${test()}) {\n${block(depth - 1, inLoop)}\n}${chance(0.6) ? ` else {\n${block(depth - 1, inLoop)}\n}` : ""}`;
      case 12:
      case 13: {
        const cases = draws.several(between(1, 3), at => `  case ${at === 0 ? 3 : at}:\n${indent(block(depth - 1, inLoop))}${chance(0.8) ? "\n    break;" : ""}`); // prettier-ignore
        return `switch (${pick(["v", "given[3]", "k", "hidden", "p.a"])}) {\n${cases.join("\n")}${chance(0.5) ? `\n  default:\n${indent(block(depth - 1, inLoop))}` : ""}\n}`;
      }
      case 14:
      case 15: {
        const name = "i" + ++names;
        return `for (let ${name} = 0; ${name} < ${pick(["2", "3", "k", "4"])}; ${name}++) {\n  if (--fuel < 0) break;\n${block(depth - 1, true)}\n}`;
      }
      case 16:
        return `try {\n${block(depth - 1, false)}\n  if (${test()}) throw ${record()};\n} catch (caught) {\n  ${pick(["p = caught;", "v = caught.a;", "note(caught.b);", "q = caught;"])}\n${block(depth - 1, false)}\n}`;
      case 17:
        return `{\n  const ask = () => ${value()};\n${block(depth - 1, false)}\n  note(ask());\n}`;
      case 18:
        return `for (const one of [${record()}, ${record()}]) {\n  if (--fuel < 0) break;\n  ${pick(["total += one.a;", "one.b = v;", "v = one.c;", "q = one;", "note(one.a + one.b);"])}\n}`;
      default:
        return `${record()} = choose(${scalar()}, ${record()}, ${record()});`;
    }
  }
  const body = draws.several(between(4, 7), () => statement(3, false)).join("\n");
  const lines = [
    "const notes = [];",
    'const show = value => (typeof value === "function" ? "function" : Array.isArray(value) ? "[" + value.map(show).join() + "]" : typeof value === "object" && value ? "{" + Object.keys(value).map(name => name + ":" + show(value[name])).join() + "}" : Object.is(value, -0) ? "-0" : typeof value === "string" ? (/=>|function|\\) \\{/.test(value) ? "code" : value.slice(0, 30)) : String(value));',
    "const note = value => void (notes.length < 120 && notes.push(show(value)));",
    'const given = JSON.parse("[0.5,1,2,3,4,-1]");',
    ...(chance(0.6) ? ['given.push("text");'] : []),
    'const hidden = JSON.parse("3");',
    "const kept = [];",
    "let fuel = 0;",
    "class Item {\n  c = 4;\n  in = { d: 5 };\n  constructor(a, b) {\n    this.a = a;\n    this.b = b;\n  }\n}",
    `function make(value) {\n  ${pick(["switch (value) {\n    case 3:\n      return { a: value, b: [value], c: value, in: { d: value } };\n  }\n  return { a: 0, b: [0], c: 1, in: { d: 2 } };", "return value > 1 ? { a: value, b: value, c: 0, in: { d: value } } : { a: 1, b: 2, c: value, in: { d: 0 } };", "const made = { a: value, b: value, c: value, in: { d: value } };\n  if (value === 2) made.a = 9;\n  return made;"])}\n}`,
    `function pick(value) {\n  ${pick(["if (value === 3) return [value, value];\n  return [0, 1];", "switch (value) {\n    case 3:\n      return [value, [value]];\n    default:\n      return [1, [2]];\n  }"])}\n}`,
    "function choose(value, x, y) {\n  return value === 3 ? x : y;\n}",
    "function sum(one) {\n  return Array.isArray(one) ? one[0] + one[1] : one.x === undefined ? one.a + one.b : one.x + one.y;\n}",
    "function run(k, v) {",
    "  let w = 1;",
    "  let total = 0;",
    "  let flag = false;",
    "  const i0 = k;",
    "  let p = { a: v, b: 1, c: 0.5, in: { d: 2 } };",
    "  let q = { a: 0, b: v, c: 3, in: { d: v } };",
    "  let r = p;",
    "  let pair = [v, 2];",
    "  let list = [1, v, 3];",
    "  let point = { x: v, y: 0 };",
    indent(body),
    "  note(total);",
    '  return [show(p), show(q), r === p, show(pair), show(list), show(point), show(v), show(w)].join("|").slice(0, 200);',
    "}",
    "for (let k = 0; k < 5; k++) {",
    "  for (const v of [given[3], given[k], k, 0.5]) {",
    "    fuel = 40;",
    "    try {",
    "      note(run(k, v));",
    "    } catch (error) {",
    '      notes.push("!" + error.name);',
    "    }",
    "  }",
    "}",
    'const all = notes.join(" ");',
    "let hash = 0;",
    "for (let at = 0; at < all.length; at++) hash = (Math.imul(hash, 31) + all.charCodeAt(at)) | 0;",
    "console.log(notes.length, hash, kept.length, all.slice(0, 400));",
  ]; // prettier-ignore
  return { name: `${statements}.mjs`, text: lines.join("\n") + "\n" };
}

writePrograms(8_000_000, write);
