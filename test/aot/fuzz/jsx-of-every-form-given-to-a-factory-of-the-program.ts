// JSX of every form, given to functions of the program's own, which print what they are called with.
//
//   tags        names of elements, with dashes and with a namespace; components, members of objects; fragments, with and without a key
//   attributes  texts in both kinds of quotes, with entities and over several lines; expressions; names alone; spreads ahead of, between and behind the others; `key`, `ref` and `children`;
//               names with dashes and namespaces; names that every object has; elements
//   children    text with spaces and line breaks in every place, entities, expressions, empty expressions, comments, spreads, lists, elements, fragments; none, one or many
//   runtimes    a factory named in tsconfig.json or in a comment, also as a member of an object; `react-jsx` and `react-jsxdev` with a source of the program's own, named in tsconfig.json or in a comment
//
// Every expression goes through `step`, so the lines also tell the order in which the parts of an element run.
import type { Random } from "./random";

export const modes = [
  "factory",
  "factory in a comment",
  "factory as a member",
  "automatic",
  "automatic for development",
  "automatic in a comment",
] as const;
export type Mode = (typeof modes)[number];

const notes = `export const lines: string[] = [];
export function show(value: unknown, depth = 0): string {
  if (typeof value === "function") return "function " + value.name;
  if (typeof value === "symbol") return String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (depth > 6) return "..";
  if (Array.isArray(value)) return "[" + value.map(each => show(each, depth + 1)).join(",") + "]";
  if (value !== null && typeof value === "object") return "{" + Reflect.ownKeys(value).map(key => String(key) + ":" + show((value as any)[key], depth + 1)).join(",") + "}";
  return Object.is(value, -0) ? "-0" : String(value);
}
export function note(...parts: unknown[]): void {
  lines.push(parts.map(part => (typeof part === "string" ? part : show(part))).join(" "));
}
export function step<T>(value: T): T {
  note("step", value);
  return value;
}
export function attempt(label: string, run: () => unknown): void {
  try {
    note(label, run());
  } catch (error) {
    note(label, "THROWS", (error as Error).constructor.name);
  }
}
let made = 0;
export function called(name: string, given: unknown[]): unknown {
  note(name, given.length, given);
  return { element: ++made, type: given[0] };
}
`;

const typesOfElements = `type Element = any;
  interface IntrinsicElements {
    [name: string]: any;
  }`;

const runtime = (names: string[]) => `import { called } from "./notes";
export const Fragment: any = Symbol.for("own.fragment");
${names.map(name => `export function ${name}(...given: unknown[]): unknown {\n  return called("${name}", given);\n}`).join("\n")}
export declare namespace JSX {
  ${typesOfElements}
}
`;

const texts = [
  "text",
  "  padded  ",
  "two words",
  "two\n    lines",
  "ends in a break\n",
  "\n  begins with one",
  "\n   \n",
  "   ",
  "a\n\n\n  b",
  "tab\there",
  "a &amp; b",
  "&lt;tag&gt;",
  "&#x41;&#66;",
  "&nbsp;",
  " &nbsp; ",
  "&unknown;",
  "&amp;amp;",
  "& alone",
  "&copy;&hearts;&Eacute;",
  'it\'s "quoted"',
  "é ✓ 🙂",
  "back\\slash \\n",
  "`tick` $ not",
  "// no comment",
  "/* none */",
] as const;

export function generate(random: Random, mode: Mode): { text: string; files: Record<string, string> } {
  let steps = 0;
  const isAutomatic = mode.startsWith("automatic");
  const step = (value?: string) => `step(${value ?? ++steps})`;

  const attribute = (depth: number): string =>
    random.weighted<() => string>([
      [
        4,
        () =>
          `${random.pick(["a", "b", "className", "id"])}="${random.pick(["text", "", "a &amp; b", "&#65;&nbsp;&lt;", "it's", "two\n    lines", "  padded  ", "back\\slash", "é ✓"])}"`,
      ],
      [1, () => `${random.pick(["a", "title"])}='${random.pick(["single", 'with "double"', "&quot;"])}'`],
      [
        5,
        () =>
          `${random.pick(["a", "b", "c", "value", "onClick"])}={${random.pick([step(), step(), `"literal"`, "undefined", "null", "() => 1", "{ a: 1 }", "[1, 2]", "`t${1}`", "-0", "1n"])}}`,
      ],
      [2, () => random.pick(["hidden", "checked", "c"])],
      [
        4,
        () =>
          `{...${random.pick([step("rest"), "rest", `{ q: ${step()} }`, "{}", step("withKey"), "(null as any)", "(undefined as any)", step("withChildren"), `{ ...rest, z: ${step()} }`])}}`,
      ],
      [3, () => `key=${random.pick(['"k"', `{${step()}}`, "{null}", "{undefined}", `{${step('"key"')}}`, '""'])}`],
      [1, () => `ref={${random.pick([step("null"), "() => {}", "{ current: null }"])}}`],
      [2, () => `${random.pick(["data-x", "aria-label", "a-b-c"])}=${random.pick(['"1"', `{${step()}}`])}`],
      [1, () => `${random.pick(["xlink:href", "a:b"])}="u"`],
      [1, () => `children=${random.pick(['"an attribute"', `{${step()}}`, "{[1, 2]}"])}`],
      [
        1,
        () =>
          `${random.pick(["constructor", "toString", "__proto__", "prototype", "default", "class", "for"])}=${random.pick(['"p"', `{${step()}}`, "{{ a: 1 }}"])}`,
      ],
      [depth < 2 ? 1 : 0, () => `part={${element(depth + 1)}}`],
      [1, () => random.pick(["__self={1}", "__source={{ fileName: 1 }}"])],
    ])();

  const child = (depth: number): string =>
    random.weighted<() => string>([
      [6, () => random.pick(texts)],
      [
        4,
        () =>
          `{${random.pick([step(), step(), `"literal"`, `" "`, "null", "undefined", "false", "true", "0", "[]", "[1, 2]", "`t`"])}}`,
      ],
      [1, () => random.pick(["{}", "{/* comment */}", "{\n// comment\n}", "{ }"])],
      [1, () => `{...${random.pick([step("[1, 2]"), "[]", `[${step()}]`])}}`],
      [depth < 3 ? 5 : 0, () => element(depth + 1)],
      [depth < 3 ? 1 : 0, () => `{${step("true")} && ${element(depth + 1)}}`],
      [depth < 3 ? 1 : 0, () => `{[1, 2].map(each => <li key={each}>${child(depth + 2)}</li>)}`],
      [1, () => "\n"],
    ])();

  function element(depth: number): string {
    const kind = random.weighted([
      [8, "tag"],
      [2, "fragment"],
      [1, "keyed fragment"],
    ] as const);
    const children = Array.from(
      {
        length: random.weighted([
          [3, 0],
          [4, 1],
          [3, 2],
          [2, 3],
          [1, 5],
        ] as const),
      },
      () => child(depth),
    ).join(random.pick(["", "", " ", "\n", "\n  "]));
    if (kind === "fragment") return `<>${children}</>`;
    if (kind === "keyed fragment") return `<Fragment key=${random.pick(['"f"', `{${step()}}`])}>${children}</Fragment>`;
    const tag = random.pick([
      "div",
      "div",
      "span",
      "p",
      "my-element",
      "svg:rect",
      "Item",
      "Item",
      "table.Cell",
      "table.inner.Deep",
      "$",
      "_",
      "a1",
    ]);
    const seen = new Set<string>();
    const attributes = Array.from(
      {
        length: random.weighted([
          [3, 0],
          [4, 1],
          [4, 2],
          [3, 3],
          [1, 6],
        ] as const),
      },
      () => attribute(depth),
    ).filter(each => {
      // TypeScript rejects a name that an element has twice.
      const name = /^[\w$:-]+/.exec(each)?.[0];
      if (!name) return true;
      // And `children` beside children.
      if (name === "children" && children) return false;
      if (seen.has(name)) return false;
      seen.add(name);
      return true;
    });
    const open = `<${tag}${attributes.map(each => random.pick([" ", " ", "\n  "]) + each).join("")}`;
    return !children && random.chance(0.7) ? `${open} />` : `${open}>${children}</${tag}>`;
  }

  const scenes = Array.from({ length: random.between(3, 8) }, (_, index) => {
    const written = element(0);
    return random.weighted([
      [6, `attempt("scene ${index}", () => ${written.includes("\n") ? `(\n${written}\n)` : written});`],
      [
        1,
        `function scene${index}(this: unknown) {\nreturn ${written.includes("\n") ? `(\n${written}\n)` : written};\n}\nattempt("scene ${index}", () => scene${index}.call({ self: ${index} }));`,
      ],
      [
        1,
        `attempt("scene ${index}", () => {\nlet last: unknown;\nfor (let turn = 0; turn < ${random.pick([2, 200])}; turn++) {\nlines.length = Math.min(lines.length, 700);\nlast = ${written.includes("\n") ? `(\n${written}\n)` : written};\n}\nreturn last;\n});`,
      ],
    ]);
  });

  const comments = {
    "factory": "",
    "factory in a comment": "/** @jsx h */\n/** @jsxFrag Fragment */\n",
    "factory as a member": "",
    "automatic": "",
    "automatic for development": "",
    "automatic in a comment": "/** @jsxRuntime automatic */\n/** @jsxImportSource own */\n",
  }[mode];
  const factory = isAutomatic
    ? `import { Fragment } from "own/jsx-runtime";`
    : `const Fragment: any = Symbol.for("own.fragment");
function h(...given: unknown[]): unknown {
  return called("h", given);
}
const library = { h, Fragment, inner: { h } };
declare global {
  namespace JSX {
    ${typesOfElements}
  }
}`;
  const text = `${comments}import { attempt, called, lines, note, step } from "./notes";
${factory}
const rest: any = { r: 1, s: "two" };
const withKey: any = { key: "spread key", t: 3 };
const withChildren: any = { children: "spread children" };
const Item: any = function Item() {};
const table: any = { Cell: function Cell() {}, inner: { Deep: function Deep() {} } };
const $: any = function dollar() {};
const _: any = function underscore() {};
const same = <T,>(value: T): T => value;
note("uses", typeof called, typeof same(1)${isAutomatic ? "" : ", typeof library"});
${scenes.join("\n")}
console.log(lines.slice(0, 900).join("\\n"));
console.log(lines.length);
`;
  const options: Record<string, unknown> = {
    target: "esnext",
    module: "preserve",
    moduleResolution: "bundler",
    noEmit: true,
    strict: true,
    types: [],
  };
  const paths = {
    "own": ["./own.ts"],
    "own/jsx-runtime": ["./own-runtime.ts"],
    "own/jsx-dev-runtime": ["./own-dev-runtime.ts"],
  };
  switch (mode) {
    case "factory":
      Object.assign(options, { jsx: "react", jsxFactory: "h", jsxFragmentFactory: "Fragment" });
      break;
    case "factory in a comment":
      Object.assign(options, { jsx: "react" });
      break;
    case "factory as a member":
      Object.assign(options, {
        jsx: "react",
        jsxFactory: random.pick(["library.h", "library.inner.h"]),
        jsxFragmentFactory: "library.Fragment",
      });
      break;
    case "automatic":
      Object.assign(options, { jsx: "react-jsx", jsxImportSource: "own", paths });
      break;
    case "automatic for development":
      Object.assign(options, { jsx: "react-jsxdev", jsxImportSource: "own", paths });
      break;
    case "automatic in a comment":
      Object.assign(options, { jsx: "react-jsx", paths });
      break;
  }
  return {
    text,
    files: {
      "notes.ts": notes,
      "tsconfig.json": JSON.stringify({ compilerOptions: options }),
      ...(isAutomatic
        ? {
            "own.ts": runtime(["createElement"]),
            "own-runtime.ts": runtime(["jsx", "jsxs"]),
            "own-dev-runtime.ts": runtime(["jsxDEV"]),
          }
        : {}),
    },
  };
}
