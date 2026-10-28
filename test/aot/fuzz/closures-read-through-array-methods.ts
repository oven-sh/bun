// Closures made in the turns of a loop or of an array method, each over that turn's own variables, and read later through array methods that follow one another.
// A chain of array methods may be compiled as one loop with its callbacks as a part of it: each turn still has variables of its own, and a closure still sees the ones it was made over.
//
//   made    `for` with one or two variables, changed in the body or skipped, a closure made in its head; for-of, for-in, entries, `while` and `do` with a constant in the block, `catch`, `var` (one variable for all turns);
//           map, flatMap, Array.from, filter and map, reduce, forEach; the list that a built-in hands back spread into push or walked at once
//           things of a second and a third place put into the same list
//   what    a closure over the variable; one that makes such a closure, once or twice over; a pair that reads and changes; a record or an instance whose method or field reads; a function, a bound function, a generator function; a function of a function, a closure that binds a function, a closure that makes a record
//           what a maker hands out is called at once, or out of an object, a list or an instance that is made for it there, or out of one arm of a condition
//   read    map, flatMap, Array.from, filter, slice, reverse, concat, a spread, closures made anew in the middle of the chain; then reduce, join, some, every, find, findLast, indexOf, includes, at, length: one to five behind one another
//           or a loop: for-of, by index up and down, `while`, for-in, entries, forEach
//   over    a whole number, a fraction, a text, a record, a list, a bigint, a closure: each made anew in its turn
//   by      there, or in a reader: a declared function, an arrow kept in a constant, a bound function, a method of an object, of a class or of an instance, a function that keeps what it is given and asks it at a later call; reached by a call, `.call`, `.apply`, Reflect.apply or as the callback of a built-in
//   alone   one thing at a time, read at once and kept nowhere: made once in front of a loop and read in every turn, also behind a condition; made behind a loop or in the arm that leaves it; in a loop whose way back runs through
//           a handler; in each activation of a function that calls itself last of all; in a small function called in a loop, one and two calls deep; between two stops of a loop; in the states of a machine; in a `finally`
//   where   returned, kept in a constant, an argument, spread, behind a condition, in a loop, in an arrow without a body, in a function that several scenes share;
//           in a function, an arrow, a method, a getter, a static block, a generator behind a `yield`, an async function behind an `await`, or in the code of the module
import type { Random } from "./random";

/** `fresh`: for a thing that makes another thing at each call: the arguments with which that other thing is called. */
type Kind = { type: string; make: (value: string, variable?: string) => string; call: (thing: string) => string; inner?: Kind; fresh?: string };

const closure: Kind = { type: "() => number", make: value => `() => ${value}`, call: thing => `${thing}()` };
const maker: Kind = { type: "() => () => number", make: value => `() => () => ${value}`, call: thing => `${thing}()()`, inner: closure, fresh: "" };
const kinds: Kind[] = [
  closure,
  closure,
  maker,
  maker,
  { type: "() => () => () => number", make: value => `() => () => () => ${value}`, call: thing => `${thing}()()()`, inner: maker },
  { type: "() => number", make: value => `function () { return ${value}; }`, call: thing => `${thing}()` },
  { type: "() => number", make: value => `((more: number) => more + ${value}).bind(null, 1)`, call: thing => `${thing}()` },
  { type: "{ read(): number }", make: value => `{ read() { return ${value}; } }`, call: thing => `${thing}.read()` },
  { type: "{ read: () => number }", make: value => `{ read: () => ${value} }`, call: thing => `${thing}.read()` },
  { type: "{ read: () => number; more: () => number }", make: (value, variable) => (variable ? `{ read: () => ${value}, more: () => ++${variable} }` : `{ read: () => ${value}, more: () => 1 }`), call: thing => `(${thing}.more(), ${thing}.read())` },
  { type: "{ read(): number }", make: value => `new (class { kept = ${value}; read() { return this.kept * 2 + ${value}; } })()`, call: thing => `${thing}.read()` },
  { type: "{ read: () => number }", make: value => `new (class { kept = 1; read = () => this.kept + ${value}; })()`, call: thing => `${thing}.read()` },
  { type: "() => Generator<number>", make: value => `function* () { yield ${value}; yield ${value} + 1; }`, call: thing => `[...${thing}()].reduce((sum, each) => sum + each, 0)` },
  { type: "(more: number) => number", make: value => `(more: number) => more * 100 + ${value}`, call: thing => `${thing}(2)` },
  { type: "() => () => number", make: value => `function () { return function () { return ${value}; }; }`, call: thing => `${thing}()()`, inner: closure, fresh: "" },
  { type: "() => (less: number) => number", make: value => `() => ((more: number, less: number) => more * 10 + less).bind(null, ${value})`, call: thing => `${thing}()(1)`, fresh: "1" },
  { type: "() => (less: number) => number", make: value => `() => ((more: number, less: number) => more * 10 + less).bind(null, ${value})`, call: thing => `${thing}()(1)`, fresh: "1" },
  { type: "() => { read: () => number }", make: value => `() => ({ read: () => ${value} })`, call: thing => `${thing}().read()` },
];

/** Asks a thing. What a maker hands out is called at once, or out of something that is made for it there: an object, a list, an instance, one arm of a condition. */
function ask(random: Random, kind: Kind, thing: string): string {
  if (kind.fresh === undefined || random.chance(0.4)) return kind.call(thing);
  return random.pick([
    `({ held: ${thing}() }).held(${kind.fresh})`,
    `({ held: ${thing}() }).held(${kind.fresh})`,
    `[${thing}()][0](${kind.fresh})`,
    `new Held(${thing}()).held(${kind.fresh})`,
    `kept(${thing}())(${kind.fresh})`,
    `((counted.length & 0) === 0 ? ${thing}() : ${thing}())(${kind.fresh})`,
    `[${thing}(), ${thing}()][1](${kind.fresh})`,
  ]);
}

const lists = ["[3, 1, 4, 1, 5]", "[0, 1, 2]", "[1.5, 2.5, -0.5]", "[7]", "([] as number[])", "[2, 4, 6, 8, 10, 12, 14, 16, 18]", "given", "Array.from({ length: 4 }, (_, at) => at * 3)", "[...given, 9]", "[1073741823, 2147483647, 4294967296]"];

const held: [make: (value: string) => string, read: (name: string) => string][] = [
  [value => `${value} + 0.5`, name => name],
  [value => `String(${value})`, name => `${name}.length`],
  [value => `"ab" + ${value}`, name => `${name}.length`],
  [value => `{ n: ${value} }`, name => `${name}.n`],
  [value => `[${value}, 1]`, name => `${name}[0]`],
  [value => `BigInt(Math.trunc(${value}))`, name => `Number(${name})`],
  [value => `() => ${value}`, name => `${name}()`],
  [value => `new Map([[1, ${value}]])`, name => `${name}.get(1)!`],
];

/** The readers that a program uses, as `form:kind`. In some programs every scene makes one kind of thing and most of them read it in one reader: closures of many places come to one call. */
type Readers = Set<string> & { kind?: Kind; form?: number; road?: number };

/** Calls what `thing` holds: there, or in a reader that is reached by one of several roads. */
function reach(random: Random, kind: Kind, thing: string, readers: Readers): string {
  if (random.chance(readers.kind ? 0.2 : 0.5)) return ask(random, kind, thing);
  const at = kinds.indexOf(kind);
  const forms: [string, string][] = [
    ["declared", `read${at}`],
    ["declared", `read${at}`],
    ["arrow", `called${at}`],
    ["bound", `bound${at}`],
    ["object", `readers.read${at}`],
    ["static", `Reads.read${at}`],
    ["instance", `reads.with${at}`],
    ["keeps", `keeps${at}`],
    ["ring", `ringed${at}`],
    ["later", `delayed${at}`],
  ];
  const [form, reader] = readers.form !== undefined && random.chance(0.8) ? forms[readers.form] : random.pick(forms);
  readers.add(`${form}:${at}`);
  const roads = [
    `${reader}(${thing})`,
    `${reader}(${thing})`,
    `${reader}.call(undefined, ${thing})`,
    `${reader}.apply(undefined, [${thing}])`,
    `Reflect.apply(${reader}, undefined, [${thing}])`,
    `[${thing}].map(${reader})[0]`,
    `Array.from([${thing}], ${reader})[0]`,
    `[${thing}].flatMap(${reader})[0]`,
  ];
  return readers.road !== undefined && random.chance(0.8) ? roads[readers.road] : random.pick(roads);
}

function declarationsOf(random: Random, readers: Readers): string[] {
  const of = (form: string) => [...readers].filter(each => each.startsWith(form + ":")).map(each => Number(each.slice(form.length + 1)));
  const member = (name: string) => (at: number) => `  ${name}${at}(each: ${kinds[at].type}) {\n    return ${ask(random, kinds[at], "each")};\n  }`;
  const lines = [
    ...of("declared").map(at => `function read${at}(each: ${kinds[at].type}) {\n  return ${ask(random, kinds[at], "each")};\n}`),
    ...of("arrow").map(at => `const called${at} = (each: ${kinds[at].type}) => ${ask(random, kinds[at], "each")};`),
    ...of("bound").map(at => `const bound${at} = function (this: unknown, each: ${kinds[at].type}) {\n  return ${ask(random, kinds[at], "each")};\n}.bind(null);`),
    // Readers that keep what they are given and ask it at a later call, when the turn or the function that made it is over.
    ...of("keeps").map(at => `let kept${at}: (${kinds[at].type}) | undefined;\nfunction keeps${at}(each: ${kinds[at].type}) {\n  const before = kept${at} ?? each;\n  kept${at} = each;\n  return ${kinds[at].call("before")};\n}`),
    ...of("ring").map(at => `const ring${at}: (${kinds[at].type})[] = [];\nfunction ringed${at}(each: ${kinds[at].type}) {\n  ring${at}.push(each);\n  if (ring${at}.length > 2) ring${at}.shift();\n  const oldest = ring${at}[0];\n  return ${kinds[at].call("oldest")};\n}`),
    ...of("later").map(at => `let later${at} = () => -1;\nfunction delayed${at}(each: ${kinds[at].type}) {\n  const was = later${at};\n  later${at} = () => ${kinds[at].call("each")};\n  return was();\n}`),
  ];
  if (of("object").length) lines.push(`const readers = {\n${of("object").map(at => member("read")(at) + ",").join("\n")}\n};`);
  if (of("static").length + of("instance").length) lines.push(`class Reads {\n${[...of("static").map(member("static read")), ...of("instance").map(member("with"))].join("\n")}\n}`);
  if (of("instance").length) lines.push("const reads = new Reads();");
  return lines;
}

function births(random: Random, kind: Kind): string {
  const n = random.pick([0, 1, 3, 3, 4, 9]);
  const list = random.pick(lists);
  const empty = `const made: (${kind.type})[] = [];\n  `;
  const over = random.chance(0.5) ? random.pick(held) : undefined;
  const block = random.pick(held);
  /** What one turn makes, as an expression: over the turn's variable itself, or over something made of it in that turn. */
  const thing = (value: string, variable?: string) => (over ? `(() => {\n      const own = ${over[0](value)};\n      return ${kind.make(over[1]("own"))};\n    })()` : kind.make(value, variable));
  return random.pick<() => string>([
    () => `${empty}for (let i = 0; i < ${n}; i++) made.push(${thing("i", "i")});`,
    () => `${empty}for (let i = 0; i < ${n}; i++) made.push(${thing("i")});`,
    () => `${empty}for (let i = 0; i < ${n}; i++) {\n    const mine = ${block[0]("i")};\n    made.push(${kind.make(block[1]("mine"))});\n  }`,
    () => `${empty}for (let i = 0; i < ${n}; i++) {\n    const mine = ${block[0]("i")};\n    made.push(${kind.make(block[1]("mine"))});\n  }`,
    () => `${empty}for (const each of ${list}) {\n    const mine = ${block[0]("each")};\n    made.push(${kind.make(block[1]("mine"))});\n  }`,
    () => `${empty}for (const each of ["a", "bc", "def", "ghij"]) made.push(${kind.make("each.length")});`,
    () => `${empty}for (const each of [{ n: 1 }, { n: 2 }, { n: 3 }]) made.push(${kind.make("each.n")});`,
    () => `${empty}for (const each of [[1], [2, 3], [4, 5, 6]]) made.push(${kind.make("each.length")});`,
    () => `${empty}for (const each of [1n, 2n, 3n]) made.push(${kind.make("Number(each)")});`,
    () => `${empty}for (const each of [() => 1, () => 2, () => 3]) made.push(${kind.make("each()")});`,
    () => `${empty}for (let text = ""; text.length < ${n}; text += "x") made.push(${kind.make("text.length")});`,
    () => `${empty}for (let i = 0; i < ${n}; i++) {\n    made.push(${thing("i")});\n    if (i % 2) i++;\n  }`,
    () => `${empty}for (let i = 0, j = 10; i < ${n}; i++, j += 3) made.push(${thing("(i * 100 + j)", "j")});`,
    () => `${empty}for (let i = 0; i < ${n}; i++) {\n    if (i === 1) continue;\n    made.push(${thing("i")});\n  }`,
    () => `${empty}for (let i = 0; i < ${n}; i++) {\n    let mine = i * 2;\n    made.push(${thing("mine", "mine")});\n    mine += 1;\n  }`,
    () => `${empty}for (let i = 0, first = ${thing("i")}; i < ${n}; i++) {\n    if (i === 0) made.push(first);\n    made.push(${thing("i")});\n  }`,
    () => `${empty}for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) made.push(${thing("(i * 10 + j)")});`,
    () => `${empty}for (var v = 0; v < ${n}; v++) made.push(${thing("v", "v")});`,
    () => `${empty}for (const each of ${list}) made.push(${thing("each")});`,
    () => `${empty}for (let each of ${list}) {\n    made.push(${thing("each", "each")});\n    each += 1;\n  }`,
    () => `${empty}for (const [at, each] of ${list}.entries()) made.push(${thing("(at * 10 + each)")});`,
    () => `${empty}for (const name in { a: 1, bc: 2, def: 3 }) made.push(${thing("name.length")});`,
    () => `${empty}let w = 0;\n  while (w < ${n}) {\n    const here = w++;\n    made.push(${thing("here")});\n  }`,
    () => `${empty}let w = 0;\n  do {\n    const here = w * 2;\n    made.push(${thing("here")});\n  } while (++w < ${n});`,
    () => `${empty}for (let i = 0; i < ${n}; i++)\n    try {\n      throw i * 3;\n    } catch (caught) {\n      const held = Number(caught);\n      made.push(${thing("held")});\n    }`,
    () => `${empty}${list}.forEach(each => {\n    made.push(${thing("each")});\n  });`,
    () => `${empty}${list}.forEach((each, at) => made.push(${thing("(each + at)")}));`,
    () => `const made = ${list}.map(each => (${thing("each")}));`,
    // Born in the callback of a built-in and handed on at once.
    () => `${empty}made.push(...${list}.map(each => (${thing("each")})));`,
    () => `${empty}made.push(...${list}.map(each => (${thing("each")})));`,
    () => `${empty}made.push(...listOf(${n}).map(each => (${kind.make("each")})));`,
    () => `${empty}made.push(...listOf(${n}).map(each => (${kind.make("each")})));`,
    () => `${empty}made.push(...${list}.flatMap(each => [${thing("each")}]));`,
    () => `${empty}for (const one of ${list}.map(each => (${thing("each")}))) made.push(one);`,
    () => `const made = [...listOf(${n}).map(each => (${kind.make("each")}))];`,
    () => `const made = Array.from(listOf(${n}), each => (${kind.make("each")}));`,
    () => `const made = ${list}.map((each, at) => (${thing("(each + at)")}));`,
    () => `const made = ${list}.map(each => {\n    let mine = each * 2;\n    return ${thing("mine", "mine")};\n  });`,
    () => `const made = ${list}.flatMap(each => [${thing("each")}, ${thing("-each")}]);`,
    () => `const made = Array.from({ length: ${n} }, (_, at) => (${thing("at")}));`,
    () => `const made = ${list}.filter(each => each % 2 === 1).map(each => (${thing("each")}));`,
    () => `const made = ${list}.map(each => each + 1).map(each => (${thing("each")}));`,
    () => `const made = ${list}.reduce((all, each) => (all.push(${thing("each")}), all), [] as (${kind.type})[]);`,
  ])();
}

function chain(random: Random, start: Kind, readers: Readers): { text: string; isList: boolean } {
  let text = random.pick(["made", "made", "made", "[...made]", "made.slice()"]);
  let kind = start;
  for (let step = random.below(3); step > 0; step--)
    text += random.pick([".slice(1)", ".filter((_, at) => at % 2 === 0)", ".slice().reverse()", ".concat(made)", ".map(each => each)", ".filter(each => each !== undefined)", ".slice(0, 3)"]);
  while (kind.inner && random.chance(0.4)) {
    text += ".map(each => each())";
    kind = kind.inner;
  }
  const call = reach(random, kind, "each", readers);
  const end = random.below(10);
  if (end === 0) return { text: `${text}.reduce((sum, each) => sum + ${call}, 0)`, isList: false };
  if (end === 1) return { text: `${text}.${random.pick(["some", "every"])}(each => ${call} > ${random.below(4)})`, isList: false };
  if (end === 2) return { text: `${text}.${random.pick(["findIndex", "findLastIndex"])}(each => ${call} % 2 === 1)`, isList: false };
  text = random.weighted([
    [6, `${text}.map(each => ${call})`],
    [1, `${text}.map((each, at) => ${call} + at)`],
    [1, `${text}.flatMap(each => [${call}, ${call}])`],
    [1, `Array.from(${text}, each => ${call})`],
    [1, `${text}.map(called${kinds.indexOf(kind)})`],
    [1, `${text}.map(read${kinds.indexOf(kind)})`],
  ]);
  if (text.endsWith(`.map(called${kinds.indexOf(kind)})`)) readers.add(`arrow:${kinds.indexOf(kind)}`);
  if (text.endsWith(`.map(read${kinds.indexOf(kind)})`)) readers.add(`declared:${kinds.indexOf(kind)}`);
  for (let step = random.below(3); step > 0; step--)
    text += random.pick([
      ".map(each => each * 2)",
      ".map(each => each + 0.5)",
      ".filter(each => each % 2 === 0)",
      ".filter(each => each > 1)",
      ".slice(1)",
      ".map(each => () => each * 2).map(each => each())",
      ".map((each, at) => () => each + at).filter(each => each() > 0).map(each => each())",
      ".map(each => ({ read: () => each })).map(each => each.read())",
      ".map(each => () => () => each).map(each => each()())",
    ]);
  const last = random.below(12);
  if (last > 6) return { text, isList: true };
  return { text: text + [".reduce((sum, each) => sum + each, 0)", `.join("-")`, ".some(each => each > 3)", ".find(each => each > 1)", ".findLast(each => each > 1)", ".includes(4)", ".at(-1)"][last], isList: false };
}

function loop(random: Random, kind: Kind, readers: Readers): string {
  const call = (thing: string) => reach(random, kind, thing, readers);
  const inPlace = call("made[next++]");
  return random.pick([
    `for (const each of made) seen.push(${call("each")});`,
    `for (let at = 0; at < made.length; at++) seen.push(${call("made[at]")});`,
    `for (let at = made.length - 1; at >= 0; at--) seen.push(${call("made[at]")});`,
    `for (let at = 0; at < made.length; at++) {\n    const each = made[at];\n    seen.push(${call("each")});\n  }`,
    // Some kinds are asked twice: `next` may go up only once a turn.
    inPlace.split("made[next++]").length === 2 ? `let next = 0;\n  while (next < made.length) seen.push(${inPlace});` : `let next = 0;\n  while (next < made.length) {\n    const each = made[next++];\n    seen.push(${call("each")});\n  }`,
    `for (const at in made) seen.push(${call("made[at]")});`,
    `for (const [at, each] of made.entries()) seen.push(${call("each")} + at);`,
    `made.forEach(each => {\n    seen.push(${call("each")});\n  });`,
    `made.forEach(each => seen.push(${call("each")}));`,
    `for (const each of made) for (let twice = 0; twice < 2; twice++) seen.push(${call("each")});`,
    `for (const each of made) for (let twice = 0; twice < 2; twice++) seen.push(${call("each")});`,
    `for (let round = 0; round < 2; round++) for (const each of made) seen.push(${call("each")});`,
    `for (let round = 0; round < 2; round++) for (const each of made) seen.push(${call("each")});`,
    `let sum = 0;\n  for (let round = 0; round < 3; round++) for (let at = 0; at < made.length; at++) sum += ${call("made[at]")};\n  seen.push(sum);`,
    `let sum = 0;\n  for (const each of made) sum += ${call("each")};\n  seen.push(sum);`,
  ]);
}

/** One thing at a time, read at once and kept nowhere: made once beside a loop, or in a turn of a loop that does not look like one. */
function oneAtATime(random: Random, kind: Kind, readers: Readers, finish: (value: string) => string, between: string): string {
  const n = random.pick([1, 2, 3, 5, 9]);
  const call = (thing: string) => reach(random, kind, thing, readers);
  const over = random.chance(0.4) ? random.pick(held) : undefined;
  /** The statements that make `name` over `value`, or over something made of it there. */
  const make = (name: string, value: string, how = "const") => (over ? `const own${name} = ${over[0](value)};\n    ${how} ${name} = ${kind.make(over[1]("own" + name))};` : `${how} ${name} = ${kind.make(value)};`);
  const stop = between.includes("await") ? "await null;" : between.includes("yield") ? "yield 1;" : "";
  const seen = "const seen: number[] = [];\n  ";
  const leaves = finish("0").startsWith("return");
  return random.pick<() => string>([
    // Made once in front of a loop and read in every turn.
    () => `${make("thing", "given.length")}\n  ${seen}for (let i = 0; i < ${n}; i++) seen.push(${call("thing")});\n  ${finish("seen")}`,
    () => `${make("thing", "given.length")}\n  ${make("other", "given[0]")}\n  ${seen}for (let i = 0; i < ${n}; i++) {\n    const one = i % 2 ? thing : other;\n    seen.push(${call("one")});\n  }\n  ${finish("seen")}`,
    () => `${make("thing", "given.length")}\n  ${make("other", "given[0]")}\n  ${seen}for (const each of given) seen.push(${call("(each > 5 ? thing : other)")});\n  ${finish("seen")}`,
    () => `${make("thing", "given.length")}\n  ${seen}for (let i = 0; i < ${n}; i++) {\n    ${make("mine", "i")}\n    const one = i % 2 ? thing : mine;\n    seen.push(${call("one")});\n  }\n  ${finish("seen")}`,
    // Made behind a loop, or in the arm that leaves it.
    () => `let total = 0;\n  for (const each of given) total += each;\n  ${make("thing", "total")}\n  ${finish(call("thing"))}`,
    () => `let found = -1;\n  for (let i = 0; i < ${n + 2}; i++) {\n    if (i === ${n}) {\n    ${make("thing", "i")}\n    ${leaves ? finish(call("thing")) : `found = ${call("thing")};\n    break;`}\n    }\n    found -= i;\n  }\n  ${finish("found")}`,
    () => `let found = -1;\n  outer: for (let i = 0; i < 3; i++)\n    for (const each of given) {\n      if (each + i > 7) {\n    ${make("thing", "(each * 10 + i)")}\n    found = ${call("thing")};\n    break outer;\n      }\n    }\n  ${finish("found")}`,
    // The way back to the head of the loop runs through a handler.
    () => `let tries = 0;\n  let got = -1;\n  for (;;) {\n    try {\n    const here = tries++;\n    ${make("thing", "here")}\n    if (here < ${n}) throw here;\n    got = ${call("thing")};\n    break;\n    } catch {\n      continue;\n    }\n  }\n  ${finish("got")}`,
    () => `let tries = 0;\n  ${seen}for (;;) {\n    const here = tries++;\n    ${make("thing", "here")}\n    try {\n      if (here < ${n}) throw here;\n      break;\n    } catch {\n      seen.push(${call("thing")});\n    }\n  }\n  ${finish("seen")}`,
    // A function that calls itself last of all makes one in each activation.
    () => `const walk = (left: number, last: ${kind.type}): number => {\n    if (left === 0) return ${call("last")};\n    ${make("next", "left")}\n    return walk(left - 1, next);\n  };\n  ${make("first", "given.length")}\n  ${finish(`walk(${n}, first)`)}`,
    () => `function walk(left: number, last: ${kind.type}, sum: number): number {\n    if (left === 0) return sum;\n    return walk(left - 1, ${kind.make("left")}, sum * 3 + ${call("last")});\n  }\n  ${finish(`walk(${n}, ${kind.make("given.length")}, 0)`)}`,
    // Made in a small function that becomes a part of the caller's loop, one and two calls deep.
    () => `const small = (value: number) => {\n    ${make("thing", "value")}\n    return thing;\n  };\n  ${seen}for (let i = 0; i < ${n}; i++) seen.push(${call("small(i)")});\n  ${finish("seen")}`,
    () => `const small = (value: number) => (${kind.make("value")});\n  const outer = (value: number) => small(value + 1);\n  ${seen}for (let i = 0; i < ${n}; i++) {\n    const one = outer(i);\n    seen.push(${call("one")});\n  }\n  ${finish("seen")}`,
    () => `const small = (value: number) => {\n    ${make("thing", "value")}\n    return ${call("thing")};\n  };\n  const outer = (value: number) => small(value) + small(value + 1);\n  ${seen}for (const each of given) seen.push(outer(each));\n  ${finish("seen")}`,
    // Between two stops of a loop, and in the states of a machine.
    () => `${seen}for (let i = 0; i < ${n}; i++) {\n    ${stop}\n    ${make("thing", "i")}\n    ${stop}\n    seen.push(${call("thing")});\n  }\n  ${finish("seen")}`,
    () => `const steps = function* () {\n    for (let i = 0; i < ${n}; i++) {\n    yield -1;\n    ${make("thing", "i")}\n    yield ${call("thing")};\n    }\n  };\n  ${finish("[...steps()]")}`,
    () => `${seen}let state = 0;\n  let turn = 0;\n  ${make("thing", "-1", "let")}\n  while (true) {\n    switch (state) {\n      case 0: {\n        const here = turn;\n        thing = ${kind.make("here")};\n        state = 1;\n        continue;\n      }\n      case 1:\n        seen.push(${call("thing")});\n        state = ++turn < ${n} ? 0 : 2;\n        continue;\n    }\n    break;\n  }\n  ${finish("seen")}`,
    // In a `finally` that a `continue`, a `break` or a throw runs.
    () => `${seen}for (let i = 0; i < ${n + 1}; i++) {\n    try {\n      if (i % 2) continue;\n      seen.push(i);\n    } finally {\n    ${make("thing", "i")}\n    seen.push(${call("thing")});\n    }\n  }\n  ${finish("seen")}`,
    () => `${seen}for (let i = 0; i < ${n + 1}; i++) {\n    try {\n      try {\n        if (i === ${n}) break;\n        if (i % 2) throw i;\n      } finally {\n    ${make("thing", "i")}\n    seen.push(${call("thing")});\n      }\n    } catch {\n      seen.push(-i);\n    }\n  }\n  ${finish("seen")}`,
  ])();
}

function scene(random: Random, readers: Readers, finish: (value: string) => string, between = ""): string {
  const kind = readers.kind ?? random.pick(kinds);
  if (random.chance(0.3)) return oneAtATime(random, kind, readers, finish, between);
  // Things of a second and a third place in one list: whoever reads the list meets more than one function.
  const born =
    births(random, kind) +
    random.weighted([
      [6, ""],
      [1, `\n  made.push(${kind.make("given.length")});`],
      [1, `\n  made.unshift(${kind.make("given.length + 0.5")});`],
      [2, `\n  for (let more = 0; more < 2; more++) made.push(${kind.make("(more + 40)")});`],
      [1, `\n  for (const more of given) made.push(more % 2 ? ${kind.make("more")} : ${kind.make("-more")});`],
      [1, `\n  for (let more = 0; more < 3; more++) made.splice(more, 0, ${kind.make("(more * 7)")});`],
    ]);
  if (random.chance(readers.kind ? 0.6 : 0.4)) return `${born}${between}\n  const seen: number[] = [];\n  ${loop(random, kind, readers)}\n  ${finish("seen")}`;
  const { text, isList } = chain(random, kind, readers);
  const end = random.weighted<string>([
    [5, finish(text)],
    [2, `const got = ${text};\n  ${finish("got")}`],
    [1, finish(`kept(${text})`)],
    [1, finish(isList ? `[...${text}]` : `[${text}]`)],
    [1, finish(`made.length > 1 ? ${text} : "few"`)],
    [1, `let last;\n  for (let again = 0; again < 3; again++) last = ${text};\n  ${finish("last")}`],
    [1, `const run = () => ${text};\n  ${finish("run()")}`],
    [1, finish(`[${text}, ${text}]`)],
  ]);
  return `${born}${between}\n  ${end}`;
}

export function generate(random: Random): string {
  const readers: Readers = new Set();
  if (random.chance(0.5)) {
    readers.kind = random.chance(0.6) ? random.pick(kinds.filter(each => each.fresh !== undefined)) : random.pick(kinds);
    readers.form = random.below(10);
    readers.road = random.below(8);
  }
  const count = readers.kind ? random.between(5, 10) : random.between(2, 6);
  const turnsOfAll = random.pick([1, 1, 1, 3, 300, undefined, undefined, undefined]);
  const lines: string[] = [];
  const answer = (value: string) => `return ${value};`;
  for (let at = 0; at < count; at++) {
    const form = random.weighted<string>([
      [6, "function"],
      [3, "module"],
      [2, "method"],
      [1, "arrow"],
      [1, "getter"],
      [1, "static block"],
      [1, "generator"],
      [1, "async"],
    ]);
    if (form === "module") {
      lines.push(`{\n  const given = [5, 6, 7];\n  ${scene(random, readers, value => `console.log(${at}, JSON.stringify(${value}));`)}\n}`);
      continue;
    }
    if (form === "static block") {
      lines.push(`class Holder${at} {\n  static value: unknown;\n  static {\n  const given = [5, 6, 7];\n  ${scene(random, readers, value => `Holder${at}.value = ${value};`)}\n  }\n}\nconsole.log(${at}, JSON.stringify(Holder${at}.value));`);
      continue;
    }
    const [declaration, call] = (
      {
        function: () => [`function scene${at}(given: number[]) {\n  ${scene(random, readers, answer)}\n}`, `scene${at}(GIVEN)`],
        arrow: () => [`const scene${at} = (given: number[]) => {\n  ${scene(random, readers, answer)}\n};`, `scene${at}(GIVEN)`],
        method: () => [`class Holder${at} {\n  run(given: number[]) {\n  ${scene(random, readers, answer)}\n  }\n}`, `new Holder${at}().run(GIVEN)`],
        getter: () => [`class Holder${at} {\n  constructor(readonly given: number[]) {}\n  get value() {\n  const given = this.given;\n  ${scene(random, readers, answer)}\n  }\n}`, `new Holder${at}(GIVEN).value`],
        generator: () => [`function* scene${at}(given: number[]) {\n  ${scene(random, readers, answer, "\n  yield made.length;")}\n}`, `finished(scene${at}(GIVEN))`],
        async: () => [`async function scene${at}(given: number[]) {\n  ${scene(random, readers, answer, "\n  await null;")}\n}`, `await scene${at}(GIVEN)`],
      } as Record<string, () => [string, string]>
    )[form]();
    // One reader may serve a scene that runs once and a scene that runs often.
    const turns = turnsOfAll ?? random.pick([1, 200, 300]);
    lines.push(declaration);
    lines.push(
      turns === 1
        ? `console.log(${at}, JSON.stringify(${call.replace("GIVEN", "[5, 6, 7]")}));`
        : `{\n  const said = new Set<string>();\n  for (let turn = 0; turn < ${turns}; turn++) said.add(JSON.stringify(${call.replace("GIVEN", "turn % 7 ? [5, 6, 7] : [turn, 1.5]")}) ?? "nothing");\n  console.log(${at}, [...said].join(" | "));\n}`,
    );
  }
  const helpers = [`function kept<T>(value: T): T {\n  return value;\n}`, `class Held<T> {\n  constructor(readonly held: T) {}\n}`, `function listOf(n: number): number[] {\n  const all: number[] = [];\n  for (let at = 0; at < n; at++) all.push(at + 4);\n  return all;\n}`, `const counted: unknown[] = [];`, `function finished<T>(steps: Generator<unknown, T, unknown>): T {\n  let step = steps.next();\n  while (!step.done) step = steps.next();\n  return step.value;\n}`];
  return [...helpers, ...declarationsOf(random, readers), ...lines, `export {};`].join("\n") + "\n";
}
