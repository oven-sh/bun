// List literals whose elements are whole numbers, fractions, -0, NaN, holes, undefined, null, texts or nothing at all go through one or two functions, meet other lists on the way, and are read.
//
//   literals   whole numbers alone, fractions alone, both, numbers that no int32 holds, -0, NaN, holes, undefined, null, texts, objects, elements computed from a parameter, spreads, empty ones
//   declared   number[], tuples, the empty tuple, lists of a union, unknown[], any[]; an empty literal typed as the empty tuple is seen again under another element type
//   roads      returned as written, behind a store, on one of two paths, out of a try, by an arrow, through a second function, in a holder, in a closure; the function is handed an empty list, the
//              list that is seen under two types, or another literal, and may return what it was handed
//   stored     elements of another kind by index, push, unshift, fill and splice, behind the end, through a name of another type; the length; removals
//   shown      by a function that only the program calls, or one that is also handed to the host
//   read       by index, at, a counted loop, for-of, a pattern, a spread; in sums, products, divisions and comparisons; joined, written as JSON, searched, copied, sorted; once or two thousand times
import type { Random } from "./random";

const whole = ["[1]", "[1, 2]", "[0]", "[7, 8, 9]", "[2147483647]", "[-1, 1]", "[n | 0]", "[n | 0, 2]"];
const fractions = [
  "[1.5]",
  "[0.1]",
  "[1, 2.5]",
  "[2.5, 1]",
  "[-0]",
  "[0, -0]",
  "[NaN]",
  "[1, NaN]",
  "[Infinity]",
  "[2147483648]",
  "[1e21, 1]",
  "[-2147483649, 0.5]",
  "[5e-324]",
  "[n]",
  "[n, 1.5]",
  "[n / 2]",
  "[n + 0.5, n]",
  "[-n]",
  "[n * -0]",
  "[0 / n]",
  "[1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5]",
];
const empty = ["[]", "[]", "[]"];
const missing = [
  "[, 1]",
  "[1, , 3]",
  "[1.5, , 2.5]",
  "[,]",
  "[, ,]",
  "[undefined]",
  "[1, undefined]",
  "[1.5, undefined]",
  "[undefined, -0]",
  "[n, , n / 2]",
];
const texts = [`["a"]`, `[1, "a"]`, `[1.5, "a"]`, `["a", NaN]`, `["", -0]`, `[String(n), n]`];
const nulls = ["[null]", "[1, null]", "[1.5, null]", "[null, -0]"];
const others = ["[{}]", "[[1.5]]", "[true]", "[1n]", "[[]]", "[{ x: 1.5 }, 1.5]", "[[1], 2]", "[false, 0.5]"];

type Group = { types: string[]; literals: string[]; holdsNumbersAlone: boolean; isTuple?: boolean };

const groups: Group[] = [
  {
    types: ["number[]", "number[]", "Array<number>"],
    literals: [...whole, ...fractions, ...fractions, ...empty],
    holdsNumbersAlone: true,
  },
  { types: ["number[]"], literals: [...fractions, ...empty], holdsNumbersAlone: true },
  {
    types: ["(number | undefined)[]"],
    literals: [...whole, ...fractions, ...missing, ...missing, ...empty],
    holdsNumbersAlone: false,
  },
  {
    types: ["(number | string)[]", "(string | number | undefined)[]"],
    literals: [...whole, ...fractions, ...texts, ...texts, ...empty],
    holdsNumbersAlone: false,
  },
  {
    types: ["(number | null)[]"],
    literals: [...whole, ...fractions, ...nulls, ...nulls, ...empty],
    holdsNumbersAlone: false,
  },
  {
    types: ["unknown[]", "any[]"],
    literals: [...whole, ...fractions, ...missing, ...texts, ...nulls, ...others, ...empty],
    holdsNumbersAlone: false,
  },
  {
    types: ["[number]"],
    literals: ["[1]", "[1.5]", "[-0]", "[NaN]", "[n]", "[n / 2]", "[2147483648]"],
    holdsNumbersAlone: true,
    isTuple: true,
  },
  {
    types: ["[number, number]"],
    literals: ["[1, 2]", "[1, 2.5]", "[2.5, 1]", "[0, -0]", "[n, 1.5]", "[NaN, 1]", "[n, n / 2]"],
    holdsNumbersAlone: true,
    isTuple: true,
  },
];

const seenAs = [
  "(string | undefined)[]",
  "number[]",
  "string[]",
  "unknown[]",
  "(number | undefined)[]",
  "object[]",
  "boolean[]",
  "[]",
  "readonly number[]",
  "number[][]",
];

const numberReads = [
  "$[0] + 1",
  "$[0] * 2",
  "$[0] / 4",
  "$[0] | 0",
  "-$[0]",
  "1 / $[0]",
  "$[0] === $[0]",
  "$[0] < 1",
  "Math.floor($[0])",
  "$[$.length - 1]",
  "$[1]",
  "$[1] + $[0]",
  "sumCounted($)",
  "sumWalked($)",
  "Math.max(...$)",
  "$.reduce((sum, each) => sum + each, 0)",
  "$.map(each => each * 2)",
  "$.filter(each => each > 1)",
  "new Float64Array($)[0]",
  "$[0].toFixed(3)",
  "$[0] % 2",
  "$[0] >>> 0",
  "Math.sign($[0])",
  "$.indexOf(1.5)",
  "$.includes(NaN)",
  "$.indexOf(-0)",
];

const reads = [
  "$",
  "$",
  "$[0]",
  "$[0]",
  "$[0]",
  "$[1]",
  "$[2]",
  "$.length",
  "$.at(-1)",
  "$.at(0)",
  "$.join()",
  "JSON.stringify($)",
  "Object.is($[0], -0)",
  "Object.is($[0], NaN)",
  "$.includes(NaN)",
  "$.includes(undefined)",
  "$.indexOf(undefined)",
  "0 in $",
  "1 in $",
  "Object.keys($).join()",
  "[...$]",
  "$.slice()",
  "$.map(each => each)",
  "$.concat($)",
  "(([first, second]) => [second, first])($)",
  "$.flat()",
  "String($)",
  "$.findLast(() => true)",
  "[...$.entries()]",
  "structuredClone($)",
  "$.toSorted()",
  "$.toReversed()",
  "$.with(0, 0.5)",
  "Number($[0]) + 1",
  "Number($[0]) * 0.5",
  "typeof $[0]",
  "$[0] == null",
  "firstOf($)",
  "firstOf($)",
  "lastOf($)",
  "Array.from($)",
  "Object.entries($)",
  "$.some(each => Object.is(each, -0))",
  "$.lastIndexOf(1)",
  "$.fill(0.5, 1)",
  "$.pop()",
  "$.shift()",
];

const numberStores = [
  "$[0] = 1.5;",
  "$[0] = n;",
  "$[0] = 3;",
  "$[0] = -0;",
  "$[1] = 0.5;",
  "$.push(0.5);",
  "$.push(n);",
  "$.push(1);",
  "$.push(-0);",
  "$.push();",
  "$[$.length] = NaN;",
  "$[3] = 1;",
  "$[5] = 2.5;",
  "$.length = 0;",
  "$.length = 1;",
  "$.length = 4;",
  "$.pop();",
  "$.shift();",
  "$.unshift(2.5);",
  "$.unshift(1);",
  "$.fill(0.25);",
  "$.fill(2);",
  "$.reverse();",
  "$.sort();",
  "$.splice(0, 1);",
  "$.splice(0, 0, 1.5);",
  "delete $[0];",
  "$.copyWithin(0, 1);",
  "$[0] += 0.5;",
  "$[0]++;",
  "$[0] /= 2;",
];

const foreignStores = [
  `$.push("a");`,
  `$[0] = "a";`,
  "$[0] = undefined;",
  "$[0] = null;",
  "$[0] = {};",
  "$[1] = [1.5];",
  "$.push(undefined);",
  "$.unshift(null);",
  "$[0] = 1n;",
  "$.fill(true);",
];

const prelude = (typed: boolean, isShownOutOfSight: boolean) => {
  const of = (type: string) => (typed ? `: ${type}` : "");
  return `${isShownOutOfSight ? `process.on("unhandledRejection", (error${of("unknown")}) => show(error));\n` : ""}let isLoud = true;
function say(line${of("string")})${of("void")} {
  if (isLoud) console.log(line);
}
function show(value${of("unknown")})${of("string")} {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "function";
  if (value instanceof RegExp) return value.source;
  if (Array.isArray(value)) {
    let text = "[";
    for (let i = 0; i < value.length; i++) text += (i ? ", " : "") + (i in value ? show(value[i]) : "hole");
    return text + "]";
  }
  if (value === null || typeof value !== "object") return String(value);
  return "{" + Object.entries(value).map(([key, each]) => key + ": " + show(each)).join(", ") + "}";
}
function kindOf(error${of("unknown")})${of("string")} {
  return error instanceof Error ? error.constructor.name : typeof error;
}
function sumCounted(list${of("number[]")})${of("number")} {
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += list[i];
  return sum;
}
function sumWalked(list${of("number[]")})${of("number")} {
  let sum = 0;
  for (const each of list) sum += each;
  return sum;
}
function firstOf(list${of("unknown[]")})${of("unknown")} {
  return list[0];
}
function lastOf(list${of("readonly unknown[]")})${of("unknown")} {
  return list[list.length - 1];
}`;
};

function scene(random: Random, typed: boolean, index: number): string {
  const of = (type: string) => (typed ? `: ${type}` : "");
  const as = (name: string, type: string) => (typed ? `(${name} as ${type})` : name);
  const group = random.pick(groups);
  const type = random.pick(group.types);
  const literal = () => random.pick(group.literals);
  const loose = (name: string) => (group.isTuple ? as(name, "number[]") : name);
  const store = (name: string) =>
    random.chance(0.2)
      ? random.pick(foreignStores).replaceAll("$", as(name, "any[]"))
      : random.pick(numberStores).replaceAll("$", group.holdsNumbersAlone ? loose(name) : as(name, "number[]"));
  const handedType = random.pick([
    "[]",
    "[]",
    "number[]",
    "(string | undefined)[]",
    "unknown[]",
    "readonly unknown[]",
    group.isTuple ? "number[]" : type,
  ]);
  const functions: string[] = [];
  const makers: string[] = [];
  const count = random.between(1, 3);
  for (let at = 0; at < count; at++) {
    const name = `make${index}_${at}`;
    const head = `function ${name}(n${of("number")}, handed${of(at === 0 || group.isTuple || random.chance(0.5) ? handedType : type)})${of(type)}`;
    const handsBack = head.includes(`handed${of(type)})`) || !typed;
    const forms: [number, () => string][] = [
      [4, () => `${head} {\n  return ${literal()};\n}`],
      [2, () => `${head} {\n  const list${of(type)} = ${literal()};\n  ${store("list")}\n  return list;\n}`],
      [2, () => `${head} {\n  if (n > 1) return ${literal()};\n  return ${literal()};\n}`],
      [2, () => `${head} {\n  return n > 1 ? ${literal()} : ${literal()};\n}`],
      [
        1,
        () =>
          `${head} {\n  try {\n    return ${literal()};\n  } finally {\n    say("${index} left " + handed.length);\n  }\n}`,
      ],
      [
        1,
        () =>
          `${head} {\n  let list${of(type)} = ${literal()};\n  for (let i = 0; i < n; i++) list = ${literal()};\n  return list;\n}`,
      ],
      [
        1,
        () =>
          `${head} {\n  const holder = { list: ${literal()}${typed ? ` as ${type}` : ""}, n };\n  return holder.list;\n}`,
      ],
      [1, () => `${head} {\n  const list${of(type)} = ${literal()};\n  const take = () => list;\n  return take();\n}`],
      [
        1,
        () =>
          `${head} {\n  const list${of(type)} = ${literal()};\n  return ${group.isTuple ? "list" : random.pick(["[...list]", "list.slice()", "list.concat(list)", "list.map(each => each)", `[...list, ...${literal()}]`])};\n}`,
      ],
      [handsBack ? 4 : 0, () => `${head} {\n  return n > 1 ? handed : ${literal()};\n}`],
      [handsBack ? 2 : 0, () => `${head} {\n  if (handed.length > 0) return handed;\n  return ${literal()};\n}`],
      [
        at > 0 ? 5 : 0,
        () =>
          `${head} {\n  return ${random.pick(makers)}(n, ${random.pick(["[]", "[]", handsBack && typed ? "[]" : "[]"])});\n}`,
      ],
      [
        at > 0 ? 2 : 0,
        () => `${head} {\n  const list = ${random.pick(makers)}(n, []);\n  ${store("list")}\n  return list;\n}`,
      ],
    ];
    functions.push(random.weighted(forms)());
    makers.push(name);
  }
  const last = makers[makers.length - 1];
  const lastTakes =
    /handed(?:: ([^)]*\)?\[?\]?[^)]*))?\)/.exec(functions[functions.length - 1].split("\n")[0])?.[1] ?? "";
  const seen = random.pick(seenAs);
  // Every third scene has all of it: the empty list, its second type, a read and a push of nothing, and both are shown.
  const hasAll = random.chance(0.33);
  const hasEmpty = hasAll || random.chance(0.75);
  const hasSeen = hasAll || (hasEmpty && random.chance(0.8));
  const lines: string[] = [];
  if (hasEmpty) lines.push(`const empty${of("[]")} = [];`);
  if (hasSeen) lines.push(`const seen${of(seen)} = empty;`);
  if (hasSeen && (hasAll || random.chance(0.5)) && seen !== "[]") lines.push("const first = seen[0];");
  if (hasEmpty && (hasAll || random.chance(0.6))) lines.push("const record = { y: empty.push() };");
  if (hasSeen && random.chance(0.25) && !seen.startsWith("readonly") && seen !== "[]")
    lines.push(`${as("seen", "any[]")}.push(${random.pick(["1.5", "1", `"a"`, "undefined", "-0", "n"])});`);
  const mayHandSeen =
    hasSeen &&
    (!typed || seen === lastTakes || lastTakes === "unknown[]" || lastTakes === "readonly unknown[]") &&
    !(typed && seen.startsWith("readonly") && !lastTakes.startsWith("readonly"));
  const given = random.weighted([
    [3, "[]"],
    [hasEmpty ? 4 : 0, "empty"],
    [mayHandSeen ? 3 : 0, "seen"],
  ]);
  lines.push(`const made = ${last}(n, ${given});`);
  for (let i = random.below(3); i > 0; i--) lines.push(store("made"));
  if (hasSeen && (hasAll || random.chance(0.7))) lines.push(`say("${index} seen " + show(seen));`);
  if (hasEmpty && random.chance(0.2)) lines.push(`say("${index} empty " + show(empty));`);
  if (random.chance(0.15)) lines.push("Bun.gc(true);");
  lines.push("return made;");
  const outer = random.chance(0.5)
    ? `function outer${index}(n${of("number")})${of(type)} {\n  ${lines.join("\n  ")}\n}`
    : `const outer${index} = (n${of("number")})${of(type)} => {\n  ${lines.join("\n  ")}\n};`;
  const typedReads = group.holdsNumbersAlone || !typed ? random.sample(numberReads, random.between(1, 4)) : [];
  const spelled = typed
    ? reads.map(read =>
        read.replaceAll("each =>", "(each: any) =>").replaceAll("([first, second])", "([first, second]: any[])"),
      )
    : reads;
  const label = (read: string) => JSON.stringify(`${index} ${read.replaceAll("$", "l")}`);
  const attempt = (read: string, l: string) =>
    `  try {\n    say(${label(read)} + " " + show(${read.replaceAll("$", l)}));\n  } catch (error) {\n    say(${label(read)} + " throws " + kindOf(error));\n  }`;
  const onTheCall = random.chance(0.3);
  const argument = random.pick(["turn % 3", "turn % 3", "turn % 2", "0", "1", "2", "turn / 2", "turn % 4 - 1"]);
  const l = (isLoose: boolean) => {
    const name = onTheCall ? `outer${index}(${argument})` : "l";
    return isLoose ? as(name, "any[]") : loose(name);
  };
  const asked = random.shuffled([
    ...typedReads.map(read => attempt(read, l(false))),
    ...random.sample(spelled, random.between(2, 6)).map(read => attempt(read, l(true))),
  ]);
  const turns = random.pick([1, 1, 3, 2000]);
  return `${functions.join("\n")}
${outer}
for (let turn = 0; turn < ${turns}; turn++) {
  isLoud = turn < 3 || turn === ${turns - 1};
${onTheCall ? "" : `  let l${of(type)};\n  try {\n    l = outer${index}(${argument});\n  } catch (error) {\n    say("${index} refused " + kindOf(error));\n    continue;\n  }\n`}${asked.join("\n")}
}
isLoud = true;`;
}

export function generate(random: Random, typed: boolean): string {
  const isShownOutOfSight = random.chance(0.6);
  const scenes = Array.from({ length: random.between(2, 6) }, (_, index) => scene(random, typed, index));
  return [prelude(typed, isShownOutOfSight), ...scenes, "export {};"].join("\n") + "\n";
}
