// Files that import names from other files, where a name may be a type, a value or both, and may be used as a type, as a value or not at all. Every file says so when it runs,
// so the lines tell which imports bring their module along, and in which order.
//
//   exported    an interface, a type, a class, an enum, a `const enum`, a namespace with and without values, a function, a constant, a variable, a default export of several kinds
//   imported    by name, under another name, with `type` in front of the name or of the braces, as a namespace, as the default, with empty braces, for its effects alone,
//               by `import name = require(..)`, and handed on by `export .. from`
//   used        never, as a type, under `typeof` in a type, behind `implements`, behind `as` and `satisfies`, as a value, in code that never runs, under a parameter of the same name, exported again
//   options     none, `verbatimModuleSyntax`, `isolatedModules`
import type { Random } from "./random";

export const options = ["none", "verbatimModuleSyntax", "isolatedModules"] as const;
export type Option = (typeof options)[number];

const notes = `export const lines: string[] = [];
export function show(value: unknown, depth = 0): string {
  if (typeof value === "function") return "function " + value.name;
  if (typeof value === "symbol") return String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (depth > 3) return "..";
  if (Array.isArray(value)) return "[" + value.map(each => show(each, depth + 1)).join(",") + "]";
  if (value !== null && typeof value === "object") return "{" + Reflect.ownKeys(value).map(key => String(key) + ":" + show((value as any)[key], depth + 1)).join(",") + "}";
  return String(value);
}
export function note(...parts: unknown[]): void {
  lines.push(parts.map(part => (typeof part === "string" ? part : show(part))).join(" "));
}
`;

// What a leaf exports: the name, whether it is a value when the program runs, whether it is a type, and whether it can stand behind `extends` or `implements`.
const exportedNames = [
  { name: "Shape", isValue: false, isType: true, isImplemented: true },
  { name: "Alias", isValue: false, isType: true },
  { name: "Thing", isValue: true, isType: true, isImplemented: true, isExtended: true },
  { name: "Kind", isValue: true, isType: true },
  { name: "Folded", isValue: true, isType: true, isFolded: true },
  { name: "Space", isValue: true, isType: false },
  { name: "Hollow", isValue: false, isType: false, isNamespaceOfTypes: true },
  { name: "act", isValue: true, isType: false },
  { name: "fixed", isValue: true, isType: false },
  { name: "changes", isValue: true, isType: false },
] as const;
type Exported = (typeof exportedNames)[number];

const leaf = (id: number, defaultExport: string) => `import { note } from "./notes";
note("runs leaf ${id}");
export interface Shape {
  a: number;
}
export type Alias = number;
export class Thing {
  a = ${id};
}
export enum Kind {
  A = ${id},
}
export const enum Folded {
  A = ${id + 100},
}
export namespace Space {
  export const a = ${id};
}
export namespace Hollow {
  export type Inner = number;
}
export function act() {
  return ${id};
}
export const fixed = ${id};
export let changes = ${id};
${defaultExport}
`;

const defaults = [
  ["export default class Main {}", true, true],
  ["export default function main() {}", true, false],
  ["export default 5;", true, false],
  ["interface Only {\n  a: number;\n}\nexport default Only;", false, true],
  ["", false, false],
] as const;

export function generate(random: Random, option: Option): { text: string; files: Record<string, string> } {
  const files: Record<string, string> = { "notes.ts": notes };
  const scenes = random.between(3, 7);
  const isVerbatim = option === "verbatimModuleSyntax";
  const isIsolated = option !== "none";
  for (let id = 0; id < scenes; id++) {
    // Under `verbatimModuleSyntax` a default export is a value.
    const [defaultText, defaultIsValue, defaultIsType] = random.pick(
      defaults.filter(([text, isValue]) => !isVerbatim || isValue || !text),
    );
    files[`leaf${id}.ts`] = leaf(id, defaultText);
    const from = `"./leaf${id}"`;
    const rows: string[] = [`import { note } from "./notes";`, `note("runs scene ${id}");`];

    // How a local name is used. `asValue` says whether the import lets it be read when the program runs.
    const uses = (
      local: string,
      what: {
        isValue: boolean;
        isType: boolean;
        isImplemented?: boolean;
        isExtended?: boolean;
        isFolded?: boolean;
        isNamespaceOfTypes?: boolean;
      },
      asValue: boolean,
    ): string[] => {
      const ways: string[][] = [[]];
      if (what.isType)
        ways.push(
          [`let held${id}: ${local} | undefined;`, `note("as a type", typeof held${id});`],
          [`note("behind as", (undefined as unknown as ${local}) === undefined);`],
          [`export type Again${id} = ${local};`],
          [
            `function takes${id}(given?: ${local}) {\nreturn given === undefined;\n}`,
            `note("a parameter", takes${id}());`,
          ],
        );
      if (what.isNamespaceOfTypes)
        ways.push([`let held${id}: ${local}.Inner | undefined;`, `note("as a type", typeof held${id});`]);
      if (what.isValue && !what.isFolded)
        ways.push([`let held${id}: typeof ${local} | undefined;`, `note("under typeof", typeof held${id});`]);
      if (what.isImplemented)
        ways.push([`class Follows${id} implements ${local} {\na = 1;\n}`, `note("implements", new Follows${id}().a);`]);
      ways.push([
        `function shadows${id}(${local}: number) {\nreturn ${local};\n}`,
        `note("shadowed", shadows${id}(1));`,
      ]);
      if (what.isValue && asValue) {
        const value = what.isFolded ? `${local}.A` : local;
        ways.push(
          [`note("as a value", ${value});`],
          [`note("as a value", ${value});`],
          [`if (false as boolean) note("never", ${value});`],
          [`function late${id}() {\nreturn ${value};\n}`, `note("declared", typeof late${id});`],
          [`note("typeof", typeof ${value});`],
        );
        if (!what.isFolded) ways.push([`export { ${local} as again${id} };`]);
        if (what.isExtended)
          ways.push([`class Below${id} extends ${local} {}`, `note("extends", new Below${id}().a);`]);
      }
      return random.pick(ways);
    };

    const drawn: Exported = random.pick(exportedNames);
    const isOnlyType = !drawn.isValue;
    // Under `verbatimModuleSyntax` what is only a type is imported with `type`; under `isolatedModules` it is handed on with `type`, and a `const enum` of another file is not read.
    const mustSayType = isVerbatim && isOnlyType;
    const mayRead = !(isIsolated && "isFolded" in drawn);
    const form = random.weighted([
      [mustSayType ? 0 : 5, "name"],
      [mustSayType ? 0 : 2, "renamed"],
      [3, "type in the braces"],
      [3, "type in front"],
      [4, "namespace"],
      [1, "namespace of types"],
      [defaultText && !(isVerbatim && !defaultIsValue) ? 3 : 0, "default"],
      [defaultText ? 1 : 0, "default as a type"],
      [defaultText && !(isVerbatim && !defaultIsValue) && !mustSayType ? 1 : 0, "default and name"],
      [2, "empty braces"],
      [2, "effects"],
      [isVerbatim ? 0 : 2, "require"],
      // `bun run` finds no such export where a type is handed on without the word `type`.
      [isOnlyType ? 0 : 2, "handed on"],
      [2, "handed on as a type"],
      [2, "all handed on"],
      [1, "all handed on under a name"],
      [mustSayType || drawn.name === "Shape" ? 0 : 1, "two statements"],
    ] as const);
    switch (form) {
      case "name":
        rows.splice(1, 0, `import { ${drawn.name} } from ${from};`);
        rows.push(...uses(drawn.name, drawn, mayRead));
        break;
      case "renamed":
        rows.splice(1, 0, `import { ${drawn.name} as local${id} } from ${from};`);
        rows.push(...uses(`local${id}`, drawn, mayRead));
        break;
      case "type in the braces":
        rows.splice(1, 0, `import { type ${drawn.name} } from ${from};`);
        rows.push(...uses(drawn.name, drawn, false));
        break;
      case "type in front":
        rows.splice(1, 0, `import type { ${drawn.name} } from ${from};`);
        rows.push(...uses(drawn.name, drawn, false));
        break;
      case "namespace":
        rows.splice(1, 0, `import * as all${id} from ${from};`);
        rows.push(
          ...random.pick([
            [],
            [`let held${id}: all${id}.Shape | undefined;`, `note("as a type", typeof held${id});`],
            [`note("a member", all${id}.fixed);`],
            [`note("keys", Object.keys(all${id}));`],
            [`let held${id}: typeof all${id} | undefined;`, `note("under typeof", typeof held${id});`],
            [`if (false as boolean) note("never", all${id}.fixed);`],
            [`export { all${id} };`],
          ]),
        );
        break;
      case "namespace of types":
        rows.splice(1, 0, `import type * as all${id} from ${from};`);
        rows.push(
          ...random.pick([
            [],
            [`let held${id}: all${id}.Shape | undefined;`, `note("as a type", typeof held${id});`],
            [`let held${id}: typeof all${id}.fixed | undefined;`, `note("under typeof", typeof held${id});`],
          ]),
        );
        break;
      case "default":
        rows.splice(1, 0, `import Main${id} from ${from};`);
        rows.push(...uses(`Main${id}`, { isValue: defaultIsValue, isType: defaultIsType }, true));
        break;
      case "default as a type":
        rows.splice(1, 0, `import type Main${id} from ${from};`);
        rows.push(...uses(`Main${id}`, { isValue: defaultIsValue, isType: defaultIsType }, false));
        break;
      case "default and name":
        rows.splice(1, 0, `import Main${id}, { ${drawn.name} } from ${from};`);
        rows.push(
          ...(random.chance(0.5)
            ? uses(`Main${id}`, { isValue: defaultIsValue, isType: defaultIsType }, true)
            : uses(drawn.name, drawn, mayRead)),
        );
        break;
      case "empty braces":
        rows.splice(
          1,
          0,
          random.pick([`import {} from ${from};`, `import type {} from ${from};`, `export {} from ${from};`]),
        );
        break;
      case "effects":
        rows.splice(1, 0, `import ${from};`);
        break;
      case "require":
        rows.splice(1, 0, `import all${id} = require(${from});`);
        rows.push(
          ...random.pick([
            [],
            [`let held${id}: all${id}.Shape | undefined;`, `note("as a type", typeof held${id});`],
            [`note("a member", all${id}.fixed);`],
            [`let held${id}: typeof all${id} | undefined;`, `note("under typeof", typeof held${id});`],
          ]),
        );
        break;
      case "handed on":
        rows.splice(
          1,
          0,
          random.pick([
            `export { ${drawn.name} } from ${from};`,
            `export { ${drawn.name} as other${id} } from ${from};`,
          ]),
        );
        break;
      case "handed on as a type":
        rows.splice(
          1,
          0,
          random.pick([`export type { ${drawn.name} } from ${from};`, `export { type ${drawn.name} } from ${from};`]),
        );
        break;
      case "all handed on":
        rows.splice(1, 0, random.pick([`export * from ${from};`, `export type * from ${from};`]));
        break;
      case "all handed on under a name":
        rows.splice(
          1,
          0,
          random.pick([`export * as all${id} from ${from};`, `export type * as all${id} from ${from};`]),
        );
        break;
      case "two statements":
        rows.splice(1, 0, `import type { Shape } from ${from};`, `import { ${drawn.name} } from ${from};`);
        rows.push(
          `let shaped${id}: Shape | undefined;`,
          `note("as a type", typeof shaped${id});`,
          ...uses(drawn.name, drawn, mayRead),
        );
        break;
    }
    rows.push(`note("ends scene ${id}");`, `export {};`);
    files[`scene${id}.ts`] = rows.join("\n") + "\n";
  }
  const text = `import { lines, note } from "./notes";
${Array.from({ length: scenes }, (_, id) => `try {\n  note("scene ${id} exports", Object.keys(await import("./scene${id}")));\n} catch (error) {\n  note("scene ${id} THROWS", (error as Error).constructor.name);\n}`).join("\n")}
console.log(lines.join("\\n"));
`;
  files["tsconfig.json"] = JSON.stringify({
    compilerOptions: {
      target: "esnext",
      module: "preserve",
      moduleResolution: "bundler",
      noEmit: true,
      strict: true,
      types: [],
      ...(option === "none" ? {} : { [option]: true }),
    },
  });
  return { text, files };
}
