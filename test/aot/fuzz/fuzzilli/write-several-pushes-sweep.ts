// Several values at once go into a list, or several lists become one: how the list is made, times the call, times what goes in, times where the call stands, times what is done with its answer, times what happens on the way.
//
//   bun write-several-pushes-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<list>--<call>--<value>--<other>--<place>--<use>--<event>.mjs or .ts
//   bun write-several-pushes-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

// `n` is a number, `given` a list of the caller.
const lists: [name: string, text: string][] = [
  ["empty", "[]"],
  ["literal", "[1, 2]"],
  ["doubles", "[0.5, 1.5]"],
  ["texts", '["a", "b"]'],
  ["mixed", '[1, "a", null]'],
  ["holes", "[1, , 3]"],
  ["by-length", "new Array(n)"],
  ["sliced", "given.slice(0, 2)"],
  ["given", "given"],
  ["mapped", "given.map(item => item)"],
  ["subclass", "new Items()"],
  ["own-push", "new Counted()"],
  ["frozen", "Object.freeze([1, 2])"],
  ["not-extensible", "Object.preventExtensions([1, 2])"],
  ["fixed-length", 'Object.defineProperty([1, 2], "length", { writable: false })'],
  ["watched", "new Proxy([1, 2], {})"],
  ["of-field", "holder.list"],
  ["sparse", "Object.assign([], { 40: 1 })"],
  ["converted", "converted([1, 2])"],
  ["named", "Object.assign([1], { named: 2 })"],
  ["of-arguments", "(function () {\n    return arguments;\n  })(1, n)"],
];
// `V`, `W` are values; `other` is another list.
const calls: [name: string, text: string][] = [
  ["two", "list.push(V, W)"],
  ["three", "list.push(V, W, i)"],
  ["four", "list.push(V, W, i, n)"],
  ["six", "list.push(V, W, V, W, i, n)"],
  ["nine", "list.push(V, W, V, W, V, W, V, W, i)"],
  ["none", "list.push()"],
  ["spread", "list.push(...other)"],
  ["value-and-spread", "list.push(V, ...other)"],
  ["spread-and-value", "list.push(...other, W)"],
  ["own-length", "list.push(list.length, list.length)"],
  ["own-push", "list.push(list.push(V), W)"],
  ["own-spread", "list.length < 9 ? list.push(...list, W) : 0"],
  ["by-call", "Array.prototype.push.call(list, V, W)"],
  ["by-apply", "Array.prototype.push.apply(list, other)"],
  ["optional", "list.push?.(V, W)"],
  ["by-key", 'list["push"](V, W)'],
  ["unshift-two", "list.unshift(V, W)"],
  ["unshift-spread", "list.unshift(...other)"],
  ["splice", "list.splice(1, 1, V, W)"],
  ["concat", "list.concat(other)"],
  ["concat-two", "list.concat(other, [V])"],
  ["concat-value", "list.concat(V)"],
  ["concat-none", "list.concat()"],
  ["concat-itself", "list.concat(list)"],
  ["concat-mixed", "list.concat(V, other, [W])"],
  ["concat-kept", "(list = list.length < 40 ? list.concat(other) : [])"],
  ["of-empty", "[].concat(list, other)"],
  ["of-spreads", "[...list, V, ...other]"],
  ["by-concat-call", "Array.prototype.concat.call(list, other)"],
  ["reversed", "other.concat(list)"],
];
const values: [name: string, text: string, second: string][] = [
  ["counters", "i", "i + 1"],
  ["doubles", "i + 0.5", "i / 3"],
  ["integer-and-double", "i", "i + 0.5"],
  ["double-and-integer", "i * 0.5", "i"],
  ["texts", '"t" + i', '"u"'],
  ["integer-and-text", "i", '"t" + i'],
  ["objects", "{ v: i }", "{ v: i, w: 1 }"],
  ["double-and-object", "i + 0.25", "{ v: i }"],
  ["nothing", "undefined", "null"],
  ["not-a-number", "NaN", "-0"],
  ["large", "2 ** 31 + i", "2 ** 53"],
  ["lists", "[i]", "[i, [n]]"],
  ["given", "given[i]", "given[i + 1]"],
  ["calls", "next()", "next()"],
  ["assigned", "(n = n + 1)", "n"],
  ["throws-late", "i", "fail(i)"],
  ["of-list", "list[0]", "list[list.length - 1]"],
  ["shortens", "list.length", "(list.length > 1 && typeof list.pop === 'function' ? list.pop() : 9)"],
  ["truths", "i > 1", "i < 1"],
  ["bigs", "BigInt(i)", "1n"],
  ["late-text", "i > 2 ? 'x' : i", "i"],
];
const others: [name: string, text: string][] = [
  ["integers", "[7, 8]"],
  ["doubles", "[7.5, 8.5]"],
  ["texts", '["x", "y", "z"]'],
  ["empty", "[]"],
  ["holes", "[7, , 9]"],
  ["mixed", '[7, "x", undefined]'],
  ["long", "Array.from({ length: 70 }, (_, at) => at)"],
  ["typed", "new Uint8Array([1, 2, 3])"],
  ["spreadable", "{ length: 2, 0: 5, 1: 6, [Symbol.isConcatSpreadable]: true, *[Symbol.iterator]() { yield 5; } }"],
  ["not-spreadable", "Object.assign([7, 8], { [Symbol.isConcatSpreadable]: false })"],
  ["subclass", "Items.from([3, 4])"],
  ["given", "given"],
  ["set", "new Set([1, 2])"],
  ["text", '"ab"'],
  ["nested", "[[1], [2, [3]]]"],
];
// `CALL` is the statement.
const places: [name: string, text: string][] = [
  ["loop", "for (let i = 0; i < n && i < 7; i++) {\n  CALL\n}"],
  ["nested", "for (let k = 0; k < 2; k++)\n  for (let i = 0; i < 3; i++) {\n    CALL\n  }"],
  ["of", "let i = 0;\nfor (const item of given) {\n  if (i > 6) break;\n  CALL\n  i++;\n}"],
  ["callback", "[0, 1, 2].forEach(i => {\n  CALL\n});"],
  ["function", "const add = i => {\n  CALL\n};\nfor (let i = 0; i < 4; i++) add(i);"],
  [
    "tried",
    "for (let i = 0; i < 5; i++) {\n  try {\n    CALL\n  } catch (error) {\n    out.push(error.name, list.length);\n  }\n}",
  ],
  ["once", "const i = 3;\n{\n  CALL\n}"],
  ["long", "for (let i = 0; i < 60; i++) {\n  CALL\n}"],
  ["while", "let i = 4;\nwhile (i-- > 0) {\n  CALL\n}"],
];
const uses: [name: string, text: string][] = [
  ["dropped", "VALUE;"],
  ["kept", "last = VALUE;"],
  ["length", "sum += VALUE.length ?? 1;"],
  ["sum", "sum += +VALUE;"],
  ["shown", "if (out.length < 12) out.push(show(VALUE));"],
];
const events: [name: string, text: string][] = [
  ["none", ""],
  ["shortened", "if (i === 2) list.length = 1;"],
  ["emptied", "if (i === 2) other.length = 0;"],
  ["kind", 'if (i === 1) list[0] = "k";'],
  ["double", "if (i === 1) other[0] = 0.5;"],
  ["exchanged", "if (i === 1) list = [0.5];"],
  ["own", "if (i === 2)\n  list.push = function () {\n    return -1;\n  };"],
  ["frozen", "if (i === 2) Object.freeze(list);"],
];
const total = lists.length * calls.length * values.length * others.length * places.length * uses.length * events.length; // prettier-ignore

function write(cell: number): { name: string; text: string } {
  let rest = cell;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const call = pick(calls);
  const list = pick(lists);
  const value = pick(values);
  const other = pick(others);
  const use = pick(uses);
  const event = pick(events);
  const place = pick(places);
  const isTyped = cell % 4 === 1;
  const isByName = cell % 3 === 0;
  const indent = (text: string, by: string) => text.split("\n").map(line => by + line).join("\n"); // prettier-ignore
  const within = (text: string, hole: string, part: string) =>
    text.replaceAll(new RegExp(`^( *)${hole}$`, "gm"), (_, by) => indent(part, by));
  const made = call[1].replaceAll(/\b[VW]\b/g, letter => (letter === "V" ? value[1] : value[2]));
  const called = [event[1], use[1].replace("VALUE", () => (use[0] === "dropped" || use[0] === "kept" || use[0] === "shown" ? made : `(${made})`))].filter(Boolean).join("\n"); // prettier-ignore
  const body = within(place[1], "CALL", called);
  const holds = (word: RegExp) => word.test(body) || word.test(list[1]) || word.test(other[1]);
  const lines = [
    ...(isTyped ? ["// @ts-nocheck"] : []),
    'const show = value => (Array.isArray(value) ? "[" + Array.from({ length: Math.min(value.length, 50) }, (_, at) => (at in value ? show(value[at]) : "hole")).join() + "]" : typeof value === "bigint" ? value + "n" : typeof value === "object" && value ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value));',
    "const out = [];",
    ...(holds(/\bItems\b/) ? ["class Items extends Array {}"] : []),
    ...(holds(/\bCounted\b/) ? ["class Counted extends Array {\n  push(...items) {\n    return super.push(items.length);\n  }\n}"] : []), // prettier-ignore
    ...(holds(/\bholder\b/) ? ["const holder = { list: [3] };"] : []),
    ...(holds(/\bconverted\(/) ? ["const converted = list => {\n  list[0] = 0.5;\n  list[1] = 2;\n  return list;\n};"] : []), // prettier-ignore
    ...(holds(/\bnext\(/) ? ["let turn = 0;\nconst next = () => ++turn;"] : []),
    ...(holds(/\bfail\(/) ? ['const fail = i => {\n  if (i > 1) throw new RangeError("f");\n  return i;\n};'] : []), // prettier-ignore
    "function work(given, n) {",
    "  let sum = 0;",
    "  let last;",
    `  let list = ${list[1]};`,
    ...(/\bother\b/.test(body) ? [`  const other = ${other[1]};`] : []),
    indent(body, "  "),
    "  out.push(show(list), list.length, show(sum), show(last));",
    "}",
    ...(isByName ? ["const bodies = { work };"] : []),
    "for (const given of [[1, 2, 3], [0.5, 2], ['p', {}, 3, 4]]) {",
    "  try {",
    isByName ? "    for (const name in bodies) bodies[name](given, 5);" : "    work(given, 5);",
    "  } catch (error) {",
    "    out.push(error.name);",
    "  }",
    "}",
    'console.log(out.join(" ").slice(0, 1200));',
    ...(isTyped ? ["export {};"] : []),
  ];
  return {
    name: `${list[0]}--${call[0]}--${value[0]}--${other[0]}--${place[0]}--${use[0]}--${event[0]}.${isTyped ? "ts" : "mjs"}`,
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
