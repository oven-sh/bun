// What a pattern takes out of a value, in which order, and what it leaves alone: patterns, times the values, times what the names are, times where the pattern stands, times who catches what it throws. Iterators, defaults, computed keys, getters and setters note that they ran.
//
//   bun write-binding-pattern-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<pattern>--<value>--<target>--<place>.mjs or .ts
//   bun write-binding-pattern-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

// `X`, `Y`, `Z` and `W` are the targets.
const patterns: [name: string, text: string][] = [
  ["nothing", "[]"],
  ["one", "[X]"],
  ["two", "[X, Y]"],
  ["four", "[X, Y, Z, W]"],
  ["second", "[, X]"],
  ["first-and-third", "[X, , Y]"],
  ["hole-behind", "[X, , ]"],
  ["default", "[X = fall(1)]"],
  ["two-defaults", "[X = fall(1), Y = fall(2)]"],
  ["four-defaults", "[X = fall(1), Y = 2, Z = fall(3), W = k]"],
  ["rest", "[...X]"],
  ["one-and-rest", "[X, ...Y]"],
  ["second-and-rest", "[, X, ...Y]"],
  ["pattern-of-rest", "[...[X, Y]]"],
  ["length-of-rest", "[X, ...{ length: Y }]"],
  ["nested", "[[X, Y], Z]"],
  ["nested-default", "[[X] = fall([7]), Y]"],
  ["nested-nothing", "[[], X]"],
  ["object-in-list", "[{ a: X }, Y]"],
  ["object-nothing", "{}"],
  ["field", "{ a: X }"],
  ["two-fields", "{ a: X, d: Y }"],
  ["missing", "{ none: X = fall(4), a: Y }"],
  ["deep", "{ a: X, b: { c: Y } }"],
  ["deep-default", "{ b: { c: X } = fall({ c: 9 }), d: Y = fall(5) }"],
  ["object-rest", "{ a: X, ...Y }"],
  ["all", "{ ...X }"],
  ["computed", '{ [key("a")]: X, [key("d")]: Y = fall(6) }'],
  ["computed-rest", '{ [key("a")]: X, ...Y }'],
  ["same-twice", "{ a: X, a: Y }"],
  ["length", "{ length: X }"],
  ["positions", "{ 0: X, 1: Y = fall(8) }"],
  ["list-in-object", "{ list: [X, Y] = fall([1]), a: Z }"],
];
const values: [name: string, text: string][] = [
  ["list", "[k, k + 1, k + 2]"],
  ["short-list", "[k]"],
  ["empty-list", "[]"],
  ["holes", "[k, , 3]"],
  ["nothings", "[undefined, null, k]"],
  ["lists", "[[k, 1], [2], k]"],
  ["objects", "[{ a: k }, { a: 2 }]"],
  ["mixed", '[k, "t" + k, 1.5, null]'],
  ["parsed-list", "lists[k]"],
  ["parsed-object", "objects[k]"],
  ["generator", "steps(k)"],
  ["throwing-generator", "stepsThatThrow(k)"],
  ["endless-generator", "endless(k)"],
  ["generator-of-pattern", "stepsOf(k & 1 ? k : [k, 1])"],
  ["generator-of-default", "stepsBy(undefined, k)"],
  ["by-hand", "byHand(k)"],
  ["without-return", "withoutReturn(k)"],
  ["bad-steps", "badSteps(k)"],
  ["map", 'new Map().set(k, 1).set("b", k)'],
  ["set", 'new Set([k, "b", k])'],
  ["text", '"a\\u{1F600}" + k'],
  ["bytes", "Uint8Array.of(k, 300, 2)"],
  ["arguments", "pack(k, 1)"],
  ["nothing-sometimes", "k === 2 ? null : [k, k]"],
  ["undefined-sometimes", "k & 1 ? undefined : { a: k, d: 1 }"],
  ["number", "k"],
  ["own-iterator", "ownIterator(k)"],
  ["literal", "{ a: k, b: { c: k + 1 }, d: undefined, list: [k] }"],
  ["literal-of-two", "{ a: 0.5, d: k }"],
  ["getters", "getters(k)"],
  ["proxy", "proxy(k)"],
  ["instance", "new Item(k)"],
  ["heir", "Object.create({ a: k, d: 3 })"],
];
const names = ["X", "Y", "Z", "W"];
const targets: [name: string, of: (name: string) => string, isAssigned: boolean][] = [
  ["let", name => name.toLowerCase(), false],
  ["const", name => name.toLowerCase(), false],
  ["var", name => name.toLowerCase(), false],
  ["parameter", name => name.toLowerCase(), false],
  ["arrow-default", name => name.toLowerCase(), false],
  ["for-of", name => name.toLowerCase(), false],
  ["for-of-let-captured", name => name.toLowerCase(), false],
  ["caught", name => name.toLowerCase(), false],
  ["callback", name => name.toLowerCase(), false],
  ["assigned", name => name.toLowerCase(), true],
  ["assigned-value", name => name.toLowerCase(), true],
  ["assigned-for-of", name => name.toLowerCase(), true],
  ["fields", name => "box." + name.toLowerCase(), true],
  ["setters", name => "noted." + name.toLowerCase(), true],
  ["elements", name => `out[at(${names.indexOf(name)})]`, true],
  ["captured", name => "held" + name, true],
];
const places: [name: string, around: string][] = [
  ["loop", "for (let k = 0; k < 4; k++) {\nTURN\n}"],
  ["inner-loop", "for (let i = 0; i < 2; i++) {\n  for (let k = 0; k < 3; k++) {\nTURN\n  }\n}"],
  ["once", "{\n  const k = at(1);\nTURN\n}"],
  [
    "generator",
    "function* walk() {\n  for (let k = 0; k < 4; k++) {\nTURN\n    yield k;\n  }\n}\nfor (const step of walk()) notes.push(step);",
  ],
  ["async", "async function walk() {\n  for (let k = 0; k < 4; k++) {\nTURN\n    await null;\n  }\n}\nawait walk();"],
  ["arrow", "const turn = (k) => {\nTURN\n};\nfor (let k = 0; k < 4; k++) turn(k);"],
];
const catches = ["turn", "around", "finally"] as const;
const total = patterns.length * values.length * targets.length * places.length * catches.length * 2;

function write(cell: number): { name: string; text: string } {
  let rest = cell;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const pattern = pick(patterns);
  const value = pick(values);
  const target = pick(targets);
  const place = pick(places);
  const caught = pick(catches);
  const isDirect = rest % 2 === 0;
  const isTyped = cell % 5 === 0;
  const bound = names.filter(name => new RegExp(`\\b${name}\\b`).test(pattern[1]));
  const text = pattern[1].replaceAll(/\b[XYZW]\b/g, name => target[1](name));
  const from = isDirect && !isTyped ? value[1] : "source(k)";
  const object = from.startsWith("{") ? `(${from})` : from;
  const show = `notes.push(${bound.map(name => `show(${target[1](name)})`).join(", ") || '"none"'});`;
  const declared = bound.length && target[2] && target[1]("X") === "x" ? `let ${bound.map(name => target[1](name)).join(", ")};\n` : ""; // prettier-ignore
  const any = isTyped ? ": any" : "";
  const turns: Record<string, string> = {
    "let": `let ${text} = ${from};\n${show}`,
    "const": `const ${text} = ${from};\n${show}`,
    "var": `var ${text} = ${from};\n${show}`,
    "parameter": `(function (${text}${any}) {\n  ${show}\n})(${from});`,
    "arrow-default": `((${text}${any} = ${object}) => {\n  ${show}\n})();`,
    "for-of": `for (const ${text} of [${from}]) {\n  ${show}\n}`,
    "for-of-let-captured": `for (let ${text} of [${from}, ${from}]) {\n  later.push(() => {\n    ${show}\n  });\n}\nlater.pop()${isTyped ? "!" : ""}();`,
    "caught": `try {\n  throw ${from};\n} catch (${text}${any}) {\n  ${show}\n}`,
    "callback": `[${from}].forEach((${text}${any}) => {\n  ${show}\n});`,
    "assigned": `${declared}(${text} = ${from});\n${show}`,
    "assigned-value": `${declared}const given = ${object};\nnotes.push(given === (${text} = given));\n${show}`,
    "assigned-for-of": `${declared}for (${text} of [${from}]) {\n  ${show}\n}`,
    "fields": `(${text} = ${from});\n${show}`,
    "setters": `(${text} = ${from});\n${show}`,
    "elements": `(${text} = ${from});\n${show}`,
    "captured": `(${text} = ${from});\n${show}`,
  };
  const plain = turns[target[0]];
  const turn =
    caught === "turn"
      ? `try {\n${plain}\n} catch (error) {\n  notes.push(told(error));\n}`
      : caught === "finally"
        ? `try {\n${plain}\n} finally {\n  notes.push("f");\n}`
        : plain;
  const body = place[1].replace("= (k) =>", isTyped ? "= (k: number) =>" : "= (k) =>").replace("TURN", () => turn);
  const t = (type: string) => (isTyped ? type : "");
  const lines = [
    `const notes${t(": any[]")} = [];`,
    `const later${t(": (() => void)[]")} = [];`,
    `const told = (error${any}) => "!" + error.name;`,
    `const show = (value${any})${t(": string")} => (typeof value === "object" && value ? (Array.isArray(value) ? "[" + value.map(show).join() + "]" : "{" + Object.keys(value).map(name => name + ":" + show(value[name])).join() + "}") : typeof value + " " + String(value));`,
    `const fall = (value${any})${any} => (notes.push("fall"), value);`,
    `const key = (name${t(": string")}) => (notes.push("key" + name), name);`,
    `const at = (index${t(": number")}) => (notes.push("at" + index), index);`,
    `const lists${any} = JSON.parse("[[1,2,3],[],[[4],5],[null,\\"t\\",1.5]]");`,
    `const objects${any} = JSON.parse('[{"a":1,"d":2},{"d":1,"b":{"c":3}},{"list":[1,2],"length":4,"b":{}},{"0":1,"a":[],"b":{"c":null}}]');`,
    `function* steps(k${any})${any} {\n  try {\n    notes.push("s0");\n    yield k;\n    notes.push("s1");\n    yield k + 0.5;\n    notes.push("s2");\n  } finally {\n    notes.push("sf");\n  }\n}`,
    `function* stepsThatThrow(k${any})${any} {\n  yield k;\n  throw new RangeError("step");\n}`,
    `function* endless(k${any})${any} {\n  try {\n    while (k < 9) yield k++;\n  } finally {\n    if (k === 3) throw new SyntaxError("closed");\n  }\n}`,
    `function* stepsOf([first, second]${any})${any} {\n  notes.push("p0");\n  yield first;\n  yield second;\n}`,
    `function* stepsBy(from${any} = fall(3), k${any} = fall(4))${any} {\n  yield from + k;\n  notes.push("b1");\n}`,
    `const byHand = (k${any})${any} => ({\n  [Symbol.iterator]() {\n    let turn = 0;\n    return {\n      next: () => (notes.push("n" + turn), { done: turn++ === 2, value: k + turn }),\n      return(value${any}) {\n        notes.push("r" + turn);\n        return { done: true, value };\n      },\n    };\n  },\n});`,
    `const withoutReturn = (k${any})${any} => ({ [Symbol.iterator]: () => ({ next: () => ({ value: k++, done: k > 4 }) }) });`,
    `const badSteps = (k${any})${any} => ({ [Symbol.iterator]: () => ({ next: () => (k & 1 ? 5 : { get done() { notes.push("done"); return k++ > 1; }, get value() { notes.push("value"); return k; } }), return: () => 7 }) });`,
    `function pack(...given${t(": any[]")})${any} {
  return (function (..._${t(": any[]")}) {
    return arguments;
  })(...given);
}`,
    `const ownIterator = (k${any})${any} => {\n  const list${any} = [k, 1, 2];\n  list[Symbol.iterator] = function* () {\n    notes.push("own");\n    yield this.length;\n    yield* [k, k];\n  };\n  return list;\n};`,
    `const getters = (k${any})${any} => ({\n  get d() {\n    notes.push("get d");\n    return k;\n  },\n  get a() {\n    notes.push("get a");\n    return undefined;\n  },\n  b: { get c() { notes.push("get c"); return k; } },\n});`,
    `const proxy = (k${any})${any} => new Proxy({ a: k, d: 2, b: { c: 1 } }, {\n  get(of${any}, name) {\n    notes.push("get " + String(name));\n    return of[name];\n  },\n  ownKeys(of) {\n    notes.push("keys");\n    return Reflect.ownKeys(of);\n  },\n});`,
    `class Item {`, ...(isTyped ? ["  a: number;"] : []), `  d = "d";`, `  b = { c: 1.5 };`, `  constructor(k${any}) {\n    this.a = k;\n  }`, `  get length() {\n    notes.push("length");\n    return 3;\n  }`, `}`, // prettier-ignore
    `const box${any} = { x: 0, y: "" };`,
    `const noted${any} = {`, ...names.map(name => `  set ${name.toLowerCase()}(value${any}) {\n    notes.push("set ${name.toLowerCase()}");\n    this.__${name.toLowerCase()} = value;\n  },\n  get ${name.toLowerCase()}() {\n    return this.__${name.toLowerCase()};\n  },`), `};`, // prettier-ignore
    `const out${any} = [];`,
    `let heldX${any}, heldY${any}, heldZ${any}, heldW${any};`,
    `const held = () => show([heldX, heldY, heldZ, heldW]);`,
    `const source = (k${t(": number")})${any} => ${value[1].startsWith("{") ? `(${value[1]})` : value[1]};`,
    `try {`,
    ...body.split("\n").map(line => "  " + line),
    `} catch (error) {\n  notes.push("left", told(error));\n}`,
    `console.log(notes.join(" "), held());`,
    ...(isTyped ? ["export {};"] : []),
  ]; // prettier-ignore
  return { name: `${pattern[0]}--${value[0]}--${target[0]}--${place[0]}${isTyped ? ".ts" : ".mjs"}`, text: lines.join("\n") + "\n" }; // prettier-ignore
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
