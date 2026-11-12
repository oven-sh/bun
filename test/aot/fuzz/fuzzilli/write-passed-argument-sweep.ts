// Arguments that are passed on: who takes them, times how they are passed on, times what is done to them on the way, times how the passing function is called, times with what.
//
//   bun write-passed-argument-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<taker>--<pass>--<change>--<call>--<given>.cjs or .mjs
//   bun write-passed-argument-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

const takers: [name: string, text: string][] = [
  ["two", "function take(a, b) {\n  return show([a, b]);\n}"],
  ["none", "function take() {\n  return show(this === undefined);\n}"],
  ["length", "function take(a) {\n  return arguments.length + show(a);\n}"],
  ["all", "function take() {\n  return show(Array.from(arguments));\n}"],
  ["rest", "function take(...all) {\n  return show(all);\n}"],
  ["first-and-rest", "function take(first, ...others) {\n  return show([first, others]);\n}"],
  ["default", "function take(a = 10, b = a) {\n  return show([a, b]);\n}"],
  ["pattern", "function take({ x } = { x: 1 }, [y] = [2]) {\n  return show([x, y]);\n}"],
  ["sum", "function take(a, b, c) {\n  return a + b + (c ?? 0);\n}"],
  ["arrow", "const take = (a, b) => show([b, a]);"],
  ["bound", "const take = function (a, b) {\n  return show([this?.v, a, b]);\n}.bind({ v: 8 });"],
  ["keeps", "function take(...all) {\n  kept.push(all);\n  return all.length;\n}"],
  ["keeps-arguments", "function take() {\n  kept.push(arguments);\n  return arguments.length;\n}"],
  ["built-in", "const take = Math.max;"],
  ["push", "const take = (...all) => [].push(...all);"],
  ["joined", "const take = (...all) => all.join();"],
  [
    "loop",
    'function take() {\n  let text = "";\n  for (let i = 0; i < arguments.length; i++) text += show(arguments[i]);\n  return text;\n}',
  ],
  [
    "of-loop",
    'function take() {\n  let text = "";\n  for (const each of arguments) text += show(each);\n  return text;\n}',
  ],
  [
    "class",
    "class Taken {\n  constructor(...all) {\n    this.all = all;\n  }\n}\nconst take = (...all) => show(new Taken(...all).all);",
  ],
  ["recursive", "function take(a, ...others) {\n  return others.length ? show(a) + take(...others) : show(a);\n}"],
];
// The body of the function that passes them on.
const passes: [name: string, head: string, text: string][] = [
  ["apply", "()", "return take.apply(this, arguments);"],
  ["spread", "()", "return take(...arguments);"],
  ["reflect", "()", "return Reflect.apply(take, undefined, arguments);"],
  ["call", "(a, b)", "return take.call(this, a, b);"],
  ["by-index", "()", "return take(arguments[0], arguments[1]);"],
  ["rest", "(...all)", "return take(...all);"],
  ["rest-apply", "(...all)", "return take.apply(null, all);"],
  ["rest-more", "(...all)", "return take(0, ...all, 9);"],
  ["sliced", "()", "return take(...Array.prototype.slice.call(arguments, 1));"],
  ["from", "()", "return take(...Array.from(arguments));"],
  ["first-rest", "(first, ...all)", "return take(...all, first);"],
  ["named-arguments", "(a, b)", "return take(...arguments, a);"],
  ["in-an-arrow", "()", "const inner = () => take(...arguments);\nreturn inner();"],
  ["in-a-callback", "()", "return [0].map(() => take.apply(this, arguments))[0];"],
  ["kept-first", "()", "const given = arguments;\nkept.push(given.length);\nreturn take.apply(null, given);"],
  [
    "copied",
    "()",
    "const all = new Array(arguments.length);\nfor (let i = 0; i < all.length; i++) all[i] = arguments[i];\nreturn take.apply(null, all);",
  ],
  [
    "two-steps",
    "()",
    "const step = function () {\n  return take.apply(this, arguments);\n};\nreturn step.apply(this, arguments);",
  ],
  ["tried", "()", "try {\n  return take(...arguments);\n} finally {\n  kept.length;\n}"],
  ["twice", "(...all)", 'return [take(...all), take(...all)].join("/");'],
  ["bind", "(...all)", "return take.bind(null, ...all)();"],
  ["concat", "()", "return take.apply(null, [7].concat(Array.from(arguments)));"],
  ["length-first", "(a)", "return arguments.length > 1 ? take.apply(null, arguments) : take(a);"],
];
const changes: [name: string, text: string][] = [
  ["none", ""],
  ["first-written", "arguments[0] = 50;"],
  ["first-text", 'arguments[0] = "w";'],
  ["added", "arguments[2] = 60;"],
  ["longer", "arguments.length = 3;"],
  ["shorter", "arguments.length = 1;"],
  ["deleted", "delete arguments[0];"],
  ["reversed", "Array.prototype.reverse.call(arguments);"],
  ["shifted", "Array.prototype.shift.call(arguments);"],
  ["iterator", "arguments[Symbol.iterator] = function* () {\n  yield 70;\n};"],
  ["read", "kept.push(arguments.length);"],
];
const callings: [name: string, text: string][] = [
  ["loop", "for (let turn = 0; turn < 3; turn++) note(() => pass(GIVEN));"],
  ["different", "note(() => pass(GIVEN));\nnote(() => pass());\nnote(() => pass(1));\nnote(() => pass(GIVEN, GIVEN));"],
  ["method", "const holder = { pass, v: 4 };\nfor (let turn = 0; turn < 2; turn++) note(() => holder.pass(GIVEN));"],
  ["spread", "const given = [GIVEN];\nfor (let turn = 0; turn < 3; turn++) note(() => pass(...given));"],
  ["callback", "note(() => [1, 2].map(pass).join());\nnote(() => pass(GIVEN));"],
  ["apply", "note(() => pass.apply({ v: 5 }, [GIVEN]));\nnote(() => pass.call({ v: 6 }, GIVEN));"],
  [
    "growing",
    "for (let turn = 0; turn < 4; turn++) note(() => pass(...Array.from({ length: turn }, (_, at) => at * 0.5)));",
  ],
  ["construct", "note(() => typeof new pass(GIVEN));\nnote(() => pass(GIVEN));"],
];
const givens: [name: string, text: string][] = [
  ["integers", "1, 2"],
  ["doubles", "0.5, -0"],
  ["texts", '"a", "b"'],
  ["mixed", '1, "b", null'],
  ["nothing", "undefined, undefined"],
  ["one", "3"],
  ["objects", "{ x: 5 }, [6]"],
  ["many", "1, 2, 3, 4, 5, 6, 7, 8, 9"],
];
const total = takers.length * passes.length * changes.length * callings.length * givens.length;

function write(cell: number): { name: string; text: string } {
  let rest = cell;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const taker = pick(takers);
  const pass = pick(passes);
  const change = pick(changes);
  const calling = pick(callings);
  const given = pick(givens);
  // Sloppy arguments follow the parameters, strict ones do not.
  const kind = ["cjs", "mjs", "cjs", "cjs"][cell % 4];
  const isStrict = cell % 4 === 2;
  const indent = (text: string, by: string) => text.split("\n").map(line => by + line).join("\n"); // prettier-ignore
  const lines = [
    ...(isStrict ? ['"use strict";'] : []),
    "const notes = [];",
    "const kept = [];",
    'const show = value => (typeof value === "function" ? "function" : Array.isArray(value) ? "[" + Array.from(value, show).join() + "]" : typeof value === "object" && value ? "{" + Object.keys(value).map(name => name + ":" + show(value[name])).join() + "}" : Object.is(value, -0) ? "-0" : String(value));',
    "const note = ask => {\n  try {\n    notes.push(show(ask()));\n  } catch (error) {\n    notes.push(error.name);\n  }\n};",
    taker[1],
    `function pass${pass[1]} {`,
    ...(change[1] ? [indent(change[1], "  ")] : []),
    indent(pass[2], "  "),
    "}",
    "{",
    indent(calling[1].replaceAll("GIVEN", () => given[1]), "  "),
    "}",
    'console.log(notes.join(" "), kept.map(each => show(typeof each === "object" ? Array.from(each) : each)).join());',
  ]; // prettier-ignore
  return {
    name: `${taker[0]}--${pass[0]}--${change[0]}--${calling[0]}--${given[0]}.${kind}`,
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
