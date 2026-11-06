// Small TypeScript programs, which the type checker accepts, about one list with a declared element type and one read of an element that is not there: past the end, below zero, in a hole, behind a `pop`
// or a shorter `length`. The type says `number`, `string` or an object; the read answers `undefined`, and what is then done with it goes as the language says: `NaN`, the text "undefined", a
// `TypeError`. There is one scene, and every line is printed at once, by `console.log` itself.
//
//   the list      `number[]` of whole numbers, of fractions, `string[]`, `boolean[]`, a list of objects, of lists, a tuple, `readonly number[]`, a typed array, an empty list; written there, handed in, a
//                 field of a class, what a function returns
//   not there     the index `length`, far past the end, `-1`, a fraction, one turn too many in a loop, a hole left by `delete`, by a longer `length`, by a store far out, by `new Array(n)`; the
//                 first element behind `length = 0`, `pop`, `shift`, `splice`; a pattern that takes more than there is
//   then          a sum, a product, a comparison, `typeof`, a template, `=== undefined`, `??`, a method of the element, a member of it, an argument of a typed function, a store into a typed
//                 field or list, the answer of a typed function, `JSON.stringify`, a key
import type { Random } from "./random";

export function generate(random: Random): string {
  const kind = random.weighted([
    [6, "whole"],
    [3, "fractions"],
    [4, "texts"],
    [1, "truths"],
    [4, "objects"],
    [2, "lists"],
    [2, "tuple"],
    [1, "readonly"],
    [2, "bytes"],
    [1, "empty"],
  ] as const);
  const [E, T, made] = {
    whole: ["number", "number[]", "[1, 2, 3]"],
    fractions: ["number", "number[]", "[1.5, 2.5, 3.5]"],
    texts: ["string", "string[]", '["a", "b", "c"]'],
    truths: ["boolean", "boolean[]", "[true, false, true]"],
    objects: ["{ n: number }", "{ n: number }[]", "[{ n: 1 }, { n: 2 }, { n: 3 }]"],
    lists: ["number[]", "number[][]", "[[1], [2], [3]]"],
    tuple: ["number", "[number, number, number]", "[1, 2, 3]"],
    readonly: ["number", "readonly number[]", "[1, 2, 3]"],
    bytes: ["number", "Uint8Array", "new Uint8Array([1, 2, 3])"],
    empty: ["number", "number[]", "[]"],
  }[kind];
  const canChange = kind !== "tuple" && kind !== "readonly" && kind !== "bytes";

  // What makes an element absent, and the read that then finds nothing. A tuple is asked through a variable, which the checker lets pass.
  const absent: [number, string, string][] = [
    kind === "tuple" ? [5, "const end: number = list.length;", "list[end]"] : [5, "", "list[list.length]"],
    [3, "const far: number = 10;", "list[far]"],
    [3, "const below: number = -1;", "list[below]"],
    [1, "const between: number = 0.5;", "list[between]"],
    [2, "const far: number = 4294967295;", "list[far]"],
    [2, "", "list.at(7)!"],
    ...(canChange
      ? ([
          [3, "delete list[1];", "list[1]"],
          [3, "list.length = 5;", "list[4]"],
          [2, `list[6] = list[0];`, "list[5]"],
          [3, "list.length = 0;", "list[0]"],
          [2, "list.pop();", "list[2]"],
          [2, "list.shift();", "list[2]"],
          [2, "list.splice(0, 3);", "list[0]"],
          [1, "list.length = 1;\nlist.length = 3;", "list[2]"],
        ] as [number, string, string][])
      : []),
  ];
  const [, change, read] = random.weighted(absent.map(each => [each[0], each] as const));

  const uses: [number, string][] = {
    number: [
      [4, "console.log(v + 1);"],
      [2, "console.log(v * 2, v - 1, v / 2);"],
      [2, "console.log(v > 0, v < 0, v === 0, v == 0);"],
      [2, "console.log(v | 0, v >>> 0, ~v);"],
      [2, "console.log(v.toFixed(1));"],
      [1, "console.log(Math.max(v, 1), Math.floor(v), Math.abs(v));"],
      [1, "console.log(-v, +v, !v);"],
      [1, "let sum = 0;\nsum += v;\nconsole.log(sum);"],
      [1, "console.log([10, 20, 30][v]);"],
      [1, "console.log(Number.isInteger(v), Number.isNaN(v), isNaN(v));"],
    ],
    string: [
      [4, 'console.log(v + "!");'],
      [3, "console.log(v.length);"],
      [2, "console.log(v.toUpperCase());"],
      [2, 'console.log(v === "a", v < "b", v == "");'],
      [1, "console.log(v[0]);"],
      [1, 'console.log("x".concat(v), [v, v].join("-"));'],
    ],
    boolean: [
      [2, 'console.log(v ? "yes" : "no", !v, v === false);'],
      [1, "console.log(v && 1, v || 2, v ?? 3);"],
    ],
    "{ n: number }": [
      [5, "console.log(v.n);"],
      [2, "console.log(v.n + 1);"],
      [2, "v.n = 5;\nconsole.log(v.n);"],
      [1, "console.log(Object.keys(v).length);"],
      [1, "const { n } = v;\nconsole.log(n);"],
      [1, "console.log({ ...v }.n);"],
    ],
    "number[]": [
      [3, "console.log(v.length);"],
      [2, "console.log(v[0]);"],
      [1, "console.log([...v].length);"],
      [1, "v.push(1);\nconsole.log(v.length);"],
    ],
  }[E] as [number, string][];
  const general: [number, string][] = [
    [3, "console.log(typeof v);"],
    [3, "console.log(`${v}`);"],
    [3, "console.log(v === undefined, v == null);"],
    [2, 'console.log(v ?? "nothing there");'],
    [2, "console.log(JSON.stringify({ v }), JSON.stringify([v]));"],
    [2, "console.log(String(v));"],
    [2, `console.log(takes(v));`],
    [2, `const holder: { held: ${E} } = { held: v };\nconsole.log(typeof holder.held, holder.held === undefined);`],
    [2, `const others: ${E}[] = [v, v];\nconsole.log(others.length, typeof others[0], 0 in others);`],
    [1, 'console.log(v ? "truthy" : "falsy");'],
    [1, "console.log(new Set([v]).has(v), [v].includes(v), [v].indexOf(v));"],
    [1, "console.log({ [String(v)]: 1 });"],
  ];
  const use = random.weighted(random.chance(0.6) ? uses : general);
  const takes = use.includes("takes(")
    ? `function takes(given: ${E}): string {\nreturn typeof given + " " + String(given === undefined);\n}`
    : "";

  const how = random.weighted([
    [6, "variable"],
    [2, "answer"],
    [read === "list[list.length]" ? 3 : 0, "loop"],
    [kind === "tuple" || kind === "bytes" ? 0 : 2, "pattern"],
  ] as const);
  const taken =
    how === "variable"
      ? `const v: ${E} = ${read};\n${use}`
      : how === "answer"
        ? `const v = pick(list);\n${use}`
        : how === "loop"
          ? `for (let i = 0; i <= list.length; i++) {\nconst v: ${E} = list[i];\n${use}\n}`
          : `const [, , , v] = list;\n${use}`;
  const pick =
    how === "answer"
      ? `function pick(list: ${T}): ${E} {\n${/^const /.test(change) ? change + "\n" : ""}return ${read};\n}`
      : "";

  const where = random.pick(["there", "there", "handed", "field", "returned"] as const);
  const born = {
    there: `const list: ${T} = ${made};`,
    handed: "",
    field: `const list = new Holder().list;`,
    returned: `const list = make();`,
  }[where];
  const declared = {
    there: "",
    handed: "",
    field: `class Holder {\nlist: ${T} = ${made};\n}`,
    returned: `function make(): ${T} {\nreturn ${made};\n}`,
  }[where];
  const body = [born, how === "answer" && /^const /.test(change) ? "" : change, taken].filter(Boolean).join("\n");
  const guarded = (text: string) =>
    `try {\n${text}\n} catch (error) {\nconsole.log("THROWS", (error as Error).constructor.name);\n}`;
  const head = [declared, takes, pick].filter(Boolean).join("\n");
  const inAFunction = where === "handed" || random.chance(0.6);
  const text = inAFunction
    ? `${head ? head + "\n" : ""}function run(${where === "handed" ? `list: ${T}` : ""}) {\n${body}\n}\n${guarded(
        Array(random.pick([1, 1, 2]))
          .fill(`run(${where === "handed" ? made : ""});`)
          .join("\n"),
      )}`
    : `${head ? head + "\n" : ""}${guarded(body)}`;
  return `${text}\nexport {};\n`;
}
