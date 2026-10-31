// Generators, async functions and async generators that suspend in the middle of expressions and statements: what was computed ahead of the suspension is kept, and is not computed again.
//
//   places      operands of every operator, arguments, callees and their receivers, `new`, elements and spreads of lists, keys and values of object literals, parts of templates and of tagged templates,
//               targets and values of assignments and compound assignments, `++`, keys, defaults and targets of patterns, heritage and keys of classes, links of optional chains, `delete`, `typeof`,
//               tests and heads of `if`, `switch`, `for`, `for .. in`, `for .. of`, `while`, `do`, what `return` and `throw` are given, `try`, `catch` and `finally`
//   meanwhile   while the function is suspended its variables, objects and lists are changed, so the lines tell what was read ahead of the suspension and what behind it
//   variables   numbers that are whole and that are not, texts, booleans, objects and lists, with written types
//   resumed     with a value, and now and then with something thrown in
import type { Random } from "./random";

export const kinds = ["generator", "async function", "async generator"] as const;
export type Kind = (typeof kinds)[number];

const head = `const lines: string[] = [];
function show(value: unknown, depth = 0): string {
  if (typeof value === "function") return "function " + value.name;
  if (typeof value === "symbol") return String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (depth > 3) return "..";
  if (Array.isArray(value)) return "[" + Array.from(value, each => show(each, depth + 1)).join(",") + "]";
  if (value instanceof Error) return value.constructor.name + " " + value.message;
  if (value !== null && typeof value === "object") return "{" + Reflect.ownKeys(value).map(key => String(key) + ":" + show((value as any)[key], depth + 1)).join(",") + "}";
  return Object.is(value, -0) ? "-0" : String(value);
}
function note(...parts: unknown[]): void {
  lines.push(parts.map(part => (typeof part === "string" ? part : show(part))).join(" "));
}
function run(label: string, make: () => any): any {
  note("runs", label);
  return make();
}
async function at(label: string, make: () => any): Promise<any> {
  note("waits at", label);
  await null;
  return make();
}
function tag(this: any, strings: TemplateStringsArray, ...given: any[]): any {
  return [strings.join("|"), given, typeof this];
}
class Base {
  base = 1;
  static fixed = "Base.fixed";
}
function same(value: any): any {
  return value;
}
const fixed: any = { one: 1, half: 2.5, zero: -0, large: 2 ** 31, text: "s", nothing: null, missing: undefined };
function failure(error: unknown): string {
  return error instanceof Error ? error.constructor.name + (error.constructor === Error ? " " + error.message : "") : show(error);
}
async function drive(name: string, walk: any): Promise<void> {
  try {
    let step = await walk.next();
    while (!step.done) {
      const [label, make, throws] = step.value;
      note("suspended at", label);
      step = throws ? await walk.throw(new Error("thrown in at " + label)) : await walk.next(make());
    }
    note(name, "answers", step.value);
  } catch (error) {
    note(name, "THROWS", failure(error));
  }
}
`;

export function generate(random: Random, kind: Kind): string {
  let labels = 0;
  const numbers = ["x", "y", "x", "y", "1", "2.5", "-0", "o.p", "o.q", "list[0]", "list.length", "(2 ** 31)", "7"];
  const others = ["text", '"s"', "(null as any)", "(undefined as any)", "flag", "o", "list", "o.missing"];
  const effects = [
    "x += 10",
    "y = -y",
    "x = 0.5",
    "y = 3",
    'text += "!"',
    "flag = !flag",
    "o = { p: 50, q: 60, m: o.m }",
    "o.p = 70",
    "o.q = 0.25",
    "list = [9, 8]",
    "list[0] = 7",
    "delete o.q",
    "list.length < 6 && list.push(6)",
    "list.length = 0",
  ];

  /** An expression that tells when it runs; mostly the function is suspended there. Meanwhile something may change. */
  const hole = (value: string): string => {
    const label = `h${labels++}`;
    const make = `() => (${random.chance(0.3) ? random.pick(effects) + ", " : ""}${value})`;
    const how = random.weighted([
      [6, kind === "generator" ? "yield" : kind === "async function" ? "await" : random.pick(["yield", "await"])],
      [2, "run"],
    ]);
    if (how === "yield") return `(yield ["${label}", ${make}${random.chance(0.03) ? ", true" : ""}])`;
    return how === "await" ? `(await at("${label}", ${make}))` : `run("${label}", ${make})`;
  };
  const number = (depth: number): string =>
    random.weighted([
      [3, () => random.pick(numbers)],
      [4, () => hole(random.pick(numbers))],
      [depth > 0 ? 2 : 0, () => `(${arithmetic(depth - 1)})`],
    ])();
  const arithmetic = (depth: number): string =>
    `${number(depth)} ${random.pick(["+", "-", "*", "/", "%", "|", "&", "^", "<<", ">>", ">>>", "+", "-", "*"])} ${number(depth)}`;
  const anything = (depth: number): string =>
    random.weighted([
      [2, () => `(${random.pick([...numbers, ...others])} as any)`],
      [4, () => hole(random.pick([...numbers, ...others]))],
      [depth > 0 ? 3 : 0, () => `((${expression(depth - 1)}) as any)`],
    ])();
  /** What stands where TypeScript looks whether a test can go both ways. */
  const tested = (depth: number): string =>
    random.weighted([
      [
        2,
        () =>
          random.pick([
            "x",
            "y",
            "text",
            "flag",
            "o",
            "list",
            "o.p",
            "o.q",
            "o.missing",
            "list[0]",
            "list.length",
            "fixed.one",
            "fixed.half",
            "fixed.zero",
            "fixed.text",
            "fixed.nothing",
            "fixed.missing",
          ]),
      ],
      [4, () => hole(random.pick([...numbers, ...others]))],
      [
        depth > 0 ? 3 : 0,
        () =>
          `same(${expression(depth - 1)
            .replace(/^\{/, "({")
            .replace(/^(\(\{.*\})$/s, "$1)")})`,
      ],
    ])();
  const object = () => random.pick(["o", hole("o"), hole("o"), `(${hole("o")})`]);
  const key = () => random.pick(['"p"', hole('"p"'), hole('"q"'), hole('"r"'), hole("0")]);
  const listOf = () => random.pick(["list", hole("list"), hole("[1, 2]"), hole('"ab"'), hole("[]")]);

  const expression = (depth: number): string =>
    random.pick<() => string>([
      () => arithmetic(depth),
      () => arithmetic(depth),
      () => `${number(depth)} ${random.pick(["<", ">", "<=", ">="])} ${number(depth)}`,
      () => `${anything(depth)} ${random.pick(["===", "!==", "==", "!="])} ${anything(depth)}`,
      () => `text + ${anything(depth)} + ${anything(depth)}`,
      () =>
        `${tested(depth)} ${random.pick(["&&", "||"])} ${tested(depth)} ${random.pick(["&&", "||"])} ${anything(depth)}`,
      () => `${tested(depth)} ?? ${tested(depth)} ?? ${anything(depth)}`,
      () => `${tested(depth)} ? ${anything(depth)} : ${anything(depth)}`,
      () => `${object()}.m(${anything(depth)}, ${anything(depth)})`,
      () => `${object()}[${hole('"m"')}](${anything(depth)})`,
      () => `${hole("o.m")}(${anything(depth)}, ...${listOf()}, ${anything(depth)})`,
      () => `o.m(${anything(depth)}, ...${listOf()}, ...${listOf()})`,
      () => `new (${hole("Base")})()`,
      () => `new Array(${hole("2")}, ${anything(depth)})`,
      () => `[${anything(depth)}, , ...${listOf()}, ${anything(depth)}]`,
      () => `[x, ${anything(depth)}, x, y, ${anything(depth)}, y, text, ${anything(depth)}, text, o.p, list[0]]`,
      () => `{ a: ${anything(depth)}, [${key()}]: ${anything(depth)}, ...${object()}, b: x, [${hole('"q"')}]: y }`,
      () => `{ x, get [${hole('"p"')}]() {\nreturn 1;\n}, [${hole('"q"')}]() {}, y, c: ${anything(depth)} }`,
      () => `\`a\${${anything(depth)}}b\${x}c\${${anything(depth)}}d\${x}\``,
      () => `tag\`a\${${anything(depth)}}b\${x}c\${${anything(depth)}}\``,
      () => `${object()}.m\`a\${${anything(depth)}}\``,
      () => `${hole(random.pick(["o", "(null as any)", "(undefined as any)"]))}?.[${key()}]`,
      () => `${hole(random.pick(["o", "(null as any)"]))}?.m(${anything(depth)})`,
      () => `${object()}.${random.pick(["m", "missing"])}?.(${anything(depth)})`,
      () => `${object()}?.inner?.[${key()}]?.(${anything(depth)})`,
      () => `typeof ${anything(depth)}`,
      () => `delete ${object()}[${key()}]`,
      () => `void ${anything(depth)}`,
      () => `-(${number(depth)})`,
      () => `!${tested(depth)}`,
      () => `(${hole(random.pick(numbers))}, ${anything(depth)})`,
      () => `${key()} in ${object()}`,
      () => `${anything(depth)} instanceof ${hole("Base")}`,
      () => `(x ${random.pick(["=", "+=", "-=", "*=", "|=", ">>>=", "**="])} ${number(depth)})`,
      () => `(text += ${anything(depth)})`,
      () => `(${object()}.p ${random.pick(["=", "+=", "-=", "||=", "&&=", "??="])} ${anything(depth)})`,
      () => `(${object()}[${key()}] ${random.pick(["=", "+=", "*=", "||=", "&&=", "??="])} ${anything(depth)})`,
      () => `(list[${hole(random.pick(["0", "1", "5"]))}] ${random.pick(["=", "+="])} ${anything(depth)})`,
      () => random.pick([`${object()}[${key()}]++`, `--${object()}[${key()}]`, `${object()}.p--`, `++${object()}.q`]),
      () => Array.from({ length: random.between(6, 14) }, () => number(0)).join(" + "),
      () => `Math.max(${Array.from({ length: random.between(4, 9) }, () => number(0)).join(", ")})`,
      () => `(() => [x, y, text, flag])()`,
    ])();

  const statement = (depth: number): string =>
    random.weighted<() => string>([
      [
        10,
        () =>
          `seen.push(${expression(2)
            .replace(/^\{/, "({")
            .replace(/^(\(\{.*\})$/s, "$1)")});`,
      ],
      [
        2,
        (n = labels++) =>
          `const { a${n} = ${anything(1)}, [${key()}]: b${n} = ${anything(1)}, ...c${n} } = ${object()};\nseen.push(a${n}, b${n}, c${n});`,
      ],
      [
        2,
        (n = labels++) =>
          `const [a${n} = ${anything(1)}, , b${n} = ${anything(1)}, ...c${n}] = ${listOf()};\nseen.push(a${n}, b${n}, c${n});`,
      ],
      [2, () => `[${object()}.p, ${object()}[${key()}] = ${anything(1)}, x = ${number(1)}] = ${listOf()};`],
      [
        2,
        () =>
          `({ p: ${object()}.r, [${key()}]: ${object()}[${key()}] = ${anything(1)}, q: y = ${number(1)} } = ${object()});`,
      ],
      [2, () => `if (${tested(1)}) seen.push("then", ${anything(1)});\nelse seen.push("else", ${anything(1)});`],
      [
        2,
        () =>
          `switch (${hole(random.pick(["1", "2", "3", "x"]))}) {\ncase ${hole("1")}:\nseen.push("first", ${anything(0)});\ncase ${hole("2")}:\nseen.push("second");\nbreak;\ndefault:\nseen.push("default", ${anything(0)});\ncase ${hole("3")}:\nseen.push("third");\n}`,
      ],
      [
        2,
        () =>
          `for (let turn: number = ${hole("0")}; turn < ${hole("2")}; turn += ${hole("1")}) seen.push(turn, ${anything(0)}, () => turn);`,
      ],
      [2, () => `for (const name in ${object()}) seen.push(name, ${anything(0)});`],
      [2, () => `for (const each of ${listOf()}) seen.push(each, ${anything(0)});`],
      [1, () => `for (${object()}.r of ${listOf()}) seen.push(o.r, ${anything(0)});`],
      [1, () => `for (const [first = ${anything(0)}] of [[], [1]] as any[]) seen.push(first);`],
      [1, () => `{\nlet turns = 0;\nwhile (${hole("turns++ < 2")}) seen.push(turns, ${anything(0)});\n}`],
      [1, () => `{\nlet turns = 0;\ndo seen.push(turns, ${anything(0)});\nwhile (${hole("++turns < 2")});\n}`],
      [
        2,
        () =>
          `try {\nseen.push(${anything(1)});\n${random.pick(["", `throw ${anything(1)};`, `(${hole("(null as any)")}).p;`])}\n} catch (error) {\nseen.push("caught", failure(error), ${anything(0)});\n} finally {\nseen.push("finally", ${anything(0)});\n}`,
      ],
      [
        1,
        () =>
          `outer: for (const first of [1, 2]) {\nfor (const second of [1, 2]) {\ntry {\nif (${hole("second === 2")}) continue outer;\nif (${hole("first === 2")}) break outer;\nseen.push(first, second);\n} finally {\nseen.push("finally", ${anything(0)});\n}\n}\n}`,
      ],
      [
        2,
        () =>
          `{\nclass Made extends (${hole(random.pick(["Base", "Base", "(null as any)", "Object"]))}) {\n[${hole('"p"')}]() {\nreturn 1;\n}\n// @ts-ignore\nstatic [${hole('"q"')}] = x;\nstatic [${hole('"p"')}]() {}\n// @ts-ignore\n[${hole('"r"')}] = y;\n}\nseen.push(Reflect.ownKeys(Made), Reflect.ownKeys(Made.prototype));\n}`,
      ],
      [
        2,
        () =>
          `{\nconst before = x, half: number = y, words: string = text, truth: boolean = flag, held = o, kept = list;\nconst read = () => [x, y, text];\nseen.push(${anything(1)});\nseen.push(before, half, words, truth, held === o, kept === list, read());\n}`,
      ],
      [
        1,
        () =>
          `{\nconst whole: number = x | 0, part: number = y + 0.5, sum: number = whole + part;\nconst got: number = ${hole("1.5")};\nseen.push(whole + got, part * got, sum - got, whole, part);\n}`,
      ],
      [
        kind === "async function" ? 0 : 1,
        () =>
          `seen.push(yield* ${kind === "generator" ? `[["inner", () => 1]] as any` : `(async function* () {\nreturn yield ["inner", () => ${random.pick(numbers)}];\n})()`});`,
      ],
      [
        depth > 0 ? 2 : 0,
        () =>
          `if (${random.pick(["flag", "x > 5", "list.length"])}) {\n${statement(depth - 1)}\n} else {\n${statement(depth - 1)}\n}`,
      ],
      [1, () => `if (${hole("x > 1000")}) return ${anything(1)};`],
      [0.5, () => `if (${hole("list.length > 5")}) throw ${anything(1)};`],
    ])();

  const rows: string[] = [];
  const scenes = random.between(3, 6);
  for (let id = 0; id < scenes; id++) {
    const body = Array.from({ length: random.between(2, 6) }, () => statement(1)).join("\n");
    const opening =
      kind === "generator"
        ? `function* scene${id}(): Generator<any, any, any>`
        : kind === "async function"
          ? `async function scene${id}(): Promise<any>`
          : `async function* scene${id}(): AsyncGenerator<any, any, any>`;
    rows.push(
      `${opening} {\nlet x: number = ${random.pick(["1", "3", "-2", "2 ** 30"])},\ny: number = ${random.pick(["2.5", "0.5", "-1.25"])},\ntext: string = "t",\nflag: boolean = ${random.pick(["true", "false"])};\nlet o: any = {\np: 1,\nq: 2,\nm(this: any, ...given: any[]) {\nreturn [this === o ? "the object of now" : typeof this, this?.p, given];\n},\n};\nlet list: any[] = [1, 2, 3];\nconst seen: unknown[] = [];\ntry {\n${body}\n} finally {\nnote("scene ${id} holds", x, y, text, flag, o, list, seen);\n}\nreturn "the end";\n}`,
      kind === "async function"
        ? `try {\nnote("scene ${id} answers", await scene${id}());\n} catch (error) {\nnote("scene ${id} THROWS", failure(error));\n}`
        : `await drive("scene ${id}", scene${id}());`,
    );
  }
  return `${head}${rows.join("\n")}\nconsole.log(lines.join("\\n"));\nexport {};\n`;
}
