// Small programs that use one member of a built-in module or one global of Bun under typings that say something else about it than what it is: typings of another version, or written by hand. TypeScript reads
// the typings and accepts every program. What runs is Bun's own member, so the executable prints what plain Bun prints. One member is used once in a program. In this order are drawn:
//
//   the member     functions and constants of node:path, node:util, node:url, node:querystring, node:buffer, node:os, node:events, node:crypto; `atob`, `btoa`, `structuredClone`; members of `Bun` and `process`
//   what is said   number, string, boolean, bigint, an object type, a list, a function, null, undefined, never, a literal type; or what the member really is
//   where it lies  @types/node in node_modules, named by "types" in tsconfig.json or found without; `declare module` in a file of the project; a declaration of the global in a file of the project or in the
//                  file that uses it
//   the files      the use in the first file, or in a file that it imports; an import by name, of the namespace, or through a file of TypeScript that exports it again
//   what is done   what the said type allows: arithmetic, comparisons, members, methods, keys, JSON, `typeof`, a call; kept in a typed variable, field or list; once or in a loop of ten thousand turns
import type { Random } from "./random";

/** `from` is the module, none for a global. `declared` writes the declaration for a result of type `T`; `reads` is the expression. */
type Member = { from?: string; name: string; declared: string; reads: string; right: string };

const call = (from: string, name: string, parameters: string, args: string, right: string): Member => ({
  from,
  name,
  declared: `function ${name}(${parameters}): T;`,
  reads: `${name}(${args})`,
  right,
});
const members: Member[] = [
  call("node:path", "join", "...parts: string[]", `"a", "b"`, "string"),
  call("node:path", "basename", "path: string", `"a/b.txt"`, "string"),
  call("node:path", "extname", "path: string", `"a.txt"`, "string"),
  call("node:path", "dirname", "path: string", `"a/b"`, "string"),
  call("node:path", "isAbsolute", "path: string", `"a"`, "boolean"),
  call("node:path", "normalize", "path: string", `"a//b"`, "string"),
  call("node:path", "parse", "path: string", `"a/b.txt"`, "{ base: string }"),
  { from: "node:path", name: "sep", declared: "const sep: T;", reads: "sep", right: "string" },
  call("node:util", "format", "...all: unknown[]", `"%d-%s", 1, "a"`, "string"),
  call("node:util", "inspect", "value: unknown", "{ a: 1 }", "string"),
  call("node:util", "isDeepStrictEqual", "one: unknown, other: unknown", "[1], [1]", "boolean"),
  call("node:url", "fileURLToPath", "url: string", `"file:///a/b"`, "string"),
  call("node:querystring", "stringify", "value: object", "{ a: 1 }", "string"),
  call("node:querystring", "parse", "text: string", `"a=1"`, "{ a: string }"),
  call("node:buffer", "isUtf8", "bytes: Uint8Array", "new Uint8Array([97])", "boolean"),
  { from: "node:os", name: "EOL", declared: "const EOL: T;", reads: "EOL", right: "string" },
  call("node:events", "getMaxListeners", "target: object", "new EventTarget()", "number"),
  call("node:crypto", "getHashes", "", "", "string[]"),
  call(
    "node:crypto",
    "timingSafeEqual",
    "one: Uint8Array, other: Uint8Array",
    "new Uint8Array(1), new Uint8Array(1)",
    "boolean",
  ),
  { name: "atob", declared: "function atob(text: string): T;", reads: `atob("YQ==")`, right: "string" },
  { name: "btoa", declared: "function btoa(text: string): T;", reads: `btoa("a")`, right: "string" },
  {
    name: "structuredClone",
    declared: "function structuredClone(value: unknown): T;",
    reads: "structuredClone({ a: 1 })",
    right: "{ a: number }",
  },
  { name: "Bun", declared: "const Bun: { inspect(value: unknown): T };", reads: "Bun.inspect(1)", right: "string" },
  {
    name: "Bun",
    declared: "const Bun: { stringWidth(text: string): T };",
    reads: `Bun.stringWidth("ab")`,
    right: "number",
  },
  {
    name: "Bun",
    declared: "const Bun: { deepEquals(one: unknown, other: unknown): T };",
    reads: "Bun.deepEquals([1], [1])",
    right: "boolean",
  },
  {
    name: "Bun",
    declared: "const Bun: { escapeHTML(text: string): T };",
    reads: `Bun.escapeHTML("<")`,
    right: "string",
  },
  {
    name: "Bun",
    declared: "const Bun: { hash: { crc32(text: string): T } };",
    reads: `Bun.hash.crc32("a")`,
    right: "number",
  },
  { name: "Bun", declared: "const Bun: { version: T };", reads: "Bun.version", right: "string" },
  { name: "process", declared: "const process: { platform: T };", reads: "process.platform", right: "string" },
  { name: "process", declared: "const process: { arch: T };", reads: "process.arch", right: "string" },
  { name: "process", declared: "const process: { exitCode: T };", reads: "process.exitCode", right: "undefined" },
];

/** What each said type allows. `$` is the value. A use without `console.log` is an expression. */
const uses: Record<string, string[]> = {
  number: [
    "$ + 1",
    "$ * 2",
    "$ | 0",
    "$ > 1",
    "-$",
    "$ === 1",
    "Math.floor($)",
    "$.toFixed(1)",
    "typeof $",
    "`${$}`",
    "[1, 2, 3][$]",
    "$ ? 1 : 2",
    "let sum = 0;\nsum += $;\nconsole.log(sum);",
  ],
  string: [
    "$.length",
    `$ + "!"`,
    "$.toUpperCase()",
    "$[0]",
    `$ === "a"`,
    "typeof $",
    "$.slice(1)",
    "`<${$}>`",
    "$.charCodeAt(0)",
    `$ < "b"`,
    "for (const part of $) console.log(typeof part);",
  ],
  boolean: [
    "$ ? 1 : 2",
    "$ === true",
    "!$",
    "typeof $",
    "$ && 1",
    "Number($)",
    `if ($) console.log("taken");\nelse console.log("not taken");`,
  ],
  bigint: ["$ + 1n", "$ === 1n", "typeof $", "$ > 0n"],
  "{ a: number }": [
    "$.a",
    "$.a + 1",
    "typeof $.a",
    "Object.keys($).length > 0",
    `"a" in $`,
    "typeof $",
    "const { a } = $;\nconsole.log(typeof a);",
  ],
  "number[]": [
    "$.length > 0",
    "typeof $[0]",
    "$[0] + 1 === $[0]",
    "Array.isArray($)",
    "typeof $.join",
    'let turns = 0;\nfor (const each of $) turns += typeof each === "number" ? 1 : 0;\nconsole.log(turns);',
  ],
  "() => number": ["typeof $", "$()", "$() + 1", "$.length"],
  null: ["$ === null", "typeof $", "$ ?? 5"],
  undefined: ["$ === undefined", "typeof $", "$ ?? 5"],
  never: [`typeof $`, `const nothing: never = $;\nconsole.log(typeof nothing);\nconsole.log("behind");`],
  "5": [
    "$ === 5",
    "$ + 1",
    "typeof $",
    `switch ($) {\ncase 5:\nconsole.log("five");\nbreak;\ndefault:\nconsole.log("another");\n}`,
  ],
  '"a"': [`$ === "a"`, "$.length", "typeof $", `({ a: 1 })[$]`],
};
const usesOfTheRight: Record<string, string[]> = {
  ...uses,
  "string[]": ["$.length > 0", "typeof $[0]", "Array.isArray($)"],
  "{ base: string }": ["$.base", "$.base.length"],
  "{ a: string }": ["$.a", "$.a + 1"],
};

export function generate(random: Random): { file: string; text: string; files: Record<string, string> } {
  // The relations first.
  const member = random.pick(members);
  const isRight = random.chance(0.1);
  const said = isRight ? member.right : random.pick(Object.keys(uses).filter(type => type !== member.right));
  const use = random.pick((isRight ? usesOfTheRight : uses)[said]);
  const place = member.from
    ? random.pick(["@types/node named", "@types/node found", "declare module"] as const)
    : random.pick([
        "a file of the project",
        "a file of the project",
        "the file that uses it",
        "@types/node named",
      ] as const);
  const reach = member.from
    ? random.pick(["by name", "by name", "the namespace", "exported again"] as const)
    : "a global";
  const keeping = random.weighted([
    [5, "nothing"],
    [2, "a variable"],
    [1, "a field"],
    [1, "a list"],
  ] as const);
  const isExpression = !use.includes("console.log");
  const loops = isExpression && random.chance(0.3);
  const guard = random.chance(0.6);
  const isUsedInAnotherFile = random.chance(0.35);
  const isStrict = random.chance(0.85);

  const files: Record<string, string> = {};
  const declaration = member.declared.replace(/\bT\b/, said);
  const ambient = member.from
    ? `declare module ${JSON.stringify(member.from)} {\n  export ${declaration}\n}\n`
    : `declare ${declaration}\n`;
  const head: string[] = [];
  if (place.startsWith("@types/node")) {
    files["node_modules/@types/node/package.json"] =
      JSON.stringify({ name: "@types/node", version: "1.0.0", types: "index.d.ts" }, null, 2) + "\n";
    files["node_modules/@types/node/index.d.ts"] = ambient;
  } else if (place === "the file that uses it") head.push(ambient.trimEnd());
  else files[member.from ? "modules.d.ts" : "globals.d.ts"] = ambient;

  let reads = member.reads;
  if (reach === "by name") head.unshift(`import { ${member.name} } from ${JSON.stringify(member.from)};`);
  else if (reach === "the namespace") {
    head.unshift(`import * as all from ${JSON.stringify(member.from)};`);
    reads = `all.${reads}`;
  } else if (reach === "exported again") {
    files["between.ts"] = `export { ${member.name} } from ${JSON.stringify(member.from)};\n`;
    head.unshift(`import { ${member.name} } from "./between";`);
  }

  const wrapped = said.includes(" ") ? `(${said})` : said;
  let lines: string[] = [];
  let held = reads;
  if (keeping === "a variable") [lines, held] = [[`const kept: ${said} = ${reads};`], "kept"];
  else if (keeping === "a field")
    [lines, held] = [
      [
        `class Keeper {\nheld: ${said};\nconstructor(held: ${said}) {\nthis.held = held;\n}\n}`,
        `const keeper = new Keeper(${reads});`,
      ],
      "keeper.held",
    ];
  else if (keeping === "a list")
    [lines, held] = [[`const kept: ${wrapped}[] = [];`, `kept.push(${reads});`], "kept[0]"];
  const text = use.replace(/\$(?!\{)/g, () => held);
  if (!isExpression) lines.push(...text.split("\n"));
  else if (loops)
    lines.push("let result;", `for (let turn = 0; turn < 10000; turn++) result = ${text};`, "console.log(result);");
  else lines.push(`console.log(${text});`);
  if (guard)
    lines = [
      "try {",
      ...lines,
      "} catch (error) {",
      `console.log("THROWS", error instanceof TypeError ? "TypeError" : error instanceof RangeError ? "RangeError" : typeof error);`,
      "}",
    ];
  files["tsconfig.json"] =
    JSON.stringify(
      {
        compilerOptions: {
          target: "esnext",
          module: "preserve",
          moduleResolution: "bundler",
          noEmit: true,
          strict: isStrict,
          skipLibCheck: true,
          // The globals of a browser are declared by nobody, so that the project may declare `atob` and the like itself.
          lib: ["esnext"],
          types: place === "@types/node named" ? ["node"] : place === "@types/node found" ? ["*"] : [],
        },
      },
      null,
      2,
    ) + "\n";
  // Without the library of a browser the project says what `console` is.
  files["console.d.ts"] =
    "declare const console: { log(...all: unknown[]): void };\n" +
    (/\bEventTarget\b/.test(reads) ? "declare class EventTarget {}\n" : "");
  const isModule = head.some(line => line.startsWith("import "));
  if (isUsedInAnotherFile) {
    files["user.ts"] = [...head, "export function run() {", ...lines, "}"].join("\n") + "\n";
    return { file: "main.ts", text: `import { run } from "./user";\nrun();\n`, files };
  }
  return { file: "main.ts", text: [...head, ...lines, ...(isModule ? [] : ["export {};"])].join("\n") + "\n", files };
}
