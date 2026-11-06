// ES modules whose exports change while the program runs, files that hand exports on, and the namespace objects that show them.
//
//   exported    `let`, `var`, `const`, functions that are assigned to, classes, a default that is an expression, a default that is a name, `export { x as default }`, one variable under two names,
//               names that are texts, names handed on by `export { x } from`, `export { x as y } from`, `export * from`, `export * as space from`, `export { default } from`
//   changed     by the file itself when a function of it is called, in a loop, by `++`, by a pattern, in a closure, later in a job
//   seen by     an import by name, under another name, through a namespace, through a namespace of a file that hands it on, through `import()`, in a closure made ahead of the change
//   twice       two files handed on by `export *` that export one name; a name of the file's own over one of `export *`; `export *` of a file with a default
//   namespaces  their keys and the order of them, attributes, `Symbol.toStringTag`, the prototype, `in`, `delete`, stores, `Object.isFrozen`, `isSealed`, `isExtensible`, `JSON.stringify`, a spread, whether two are one
//   too early   files that need each other and read an export of the other ahead of its declaration
import type { Random } from "./random";

const notes = `export const lines = [];
export function show(value, depth = 0) {
  // Plain Bun names a default export without a name after its file.
  if (typeof value === "function") return (/^class/.test(Function.prototype.toString.call(value)) ? "class " : "function ") + value.name.replace(/^\\w+_default$/, "default");
  if (typeof value === "symbol") return String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (value === null || typeof value !== "object") return String(value);
  if (depth > 2) return "..";
  return (Object.prototype.toString.call(value) === "[object Module]" ? "Module" : "") + "{" + Reflect.ownKeys(value).map(key => {
    try {
      return String(key) + ":" + show(value[key], depth + 1);
    } catch (error) {
      return String(key) + ":THROWS " + error.constructor.name;
    }
  }).join(",") + "}";
}
export function note(...parts) {
  lines.push(parts.map(part => (typeof part === "string" ? part : show(part))).join(" "));
}
export function attempt(label, run) {
  try {
    note(label, "=", run());
  } catch (error) {
    note(label, "THROWS", error.constructor.name);
  }
}
`;

export function generate(random: Random): { text: string; files: Record<string, string> } {
  const files: Record<string, string> = { "notes.js": notes };
  const top = `import { note, attempt } from "./notes.js";\n`;
  const rows: string[] = [];
  const imports: string[] = [];
  const sources = random.between(2, 4);

  for (let id = 0; id < sources; id++) {
    const defaults = random.pick([
      `export default count${id};`,
      `export { count${id} as default };`,
      `export default function () {\nreturn "the default function of source ${id}";\n}`,
      `export default class {}`,
      `export default () => "an arrow";`,
      `export default function named${id}() {}\nexport function renames${id}() {\nnamed${id} = "assigned";\n}`,
      `export default [count${id}];`,
      ``,
    ]);
    files[`source${id}.js`] =
      `${top}note("runs source ${id}");\nexport let count${id} = ${id};\nexport var old${id} = "old";\nexport const fixed${id} = { inner: ${id} };\nexport function act${id}() {\nreturn "act ${id}";\n}\nexport class Kind${id} {}\nlet hidden${id} = "hidden";\nexport { hidden${id} as shown${id}, hidden${id} as also${id}, count${id} as "a text ${id}" };\nexport const shared = "shared of source ${id}";\n` +
      `export function step${id}() {\ncount${id}++;\nold${id} += "!";\nhidden${id} = hidden${id} + "?";\nreturn count${id};\n}\nexport function replace${id}() {\nact${id} = () => "replaced";\nKind${id} = class Other {};\n[count${id}, old${id}] = [100, "by a pattern"];\n}\nexport function later${id}() {\nreturn Promise.resolve().then(() => {\ncount${id} = "later";\n});\n}\nexport const reads${id} = () => [count${id}, old${id}, hidden${id}];\n${defaults}\n`;
  }

  // Files that hand exports on.
  const middle = random.between(1, 3);
  for (let id = 0; id < middle; id++) {
    const from = random.below(sources);
    const second = random.below(sources);
    const parts = random.sample(
      [
        `export { count${from} } from "./source${from}.js";`,
        `export { count${from} as renamed${id}, step${from} as stepOn${id} } from "./source${from}.js";`,
        `export * from "./source${from}.js";`,
        ...(second !== from ? [`export * from "./source${second}.js";`] : []),
        `export * as space${id} from "./source${second}.js";`,
        `export { default } from "./source${from}.js";`,
        `export { default as given${id} } from "./source${second}.js";`,
        `export const shared = "shared of middle ${id}";`,
        `import { count${second} as mine } from "./source${second}.js";\nexport { mine as mine${id} };`,
        `import * as whole from "./source${second}.js";\nexport { whole as whole${id} };`,
        `export { "a text ${from}" as plain${id} } from "./source${from}.js";`,
      ],
      random.between(1, 5),
    );
    // `export { default }` needs a default, which a source may lack.
    const safe = parts.filter(
      part =>
        !/default/.test(part) || /export default|as default/.test(files[`source${/source(\d)/.exec(part)![1]}.js`]),
    );
    files[`middle${id}.js`] = `${top}note("runs middle ${id}");\n${safe.join("\n")}\n`;
  }

  const spaces: string[] = [];
  for (let id = 0; id < sources; id++) {
    imports.push(
      `import * as source${id} from "./source${id}.js";`,
      `import { count${id}, old${id}, act${id}, Kind${id}, shown${id}, also${id}, step${id}, replace${id}, later${id}, reads${id}, count${id} as again${id}, "a text ${id}" as text${id} } from "./source${id}.js";`,
    );
    spaces.push(`source${id}`);
  }
  for (let id = 0; id < middle; id++) {
    imports.push(`import * as middle${id} from "./middle${id}.js";`);
    spaces.push(`middle${id}`);
  }

  for (let left = random.between(8, 18); left > 0; left--) {
    const id = random.below(sources);
    const space = random.pick(spaces);
    rows.push(
      random.pick<() => string>([
        () =>
          `note("sees", count${id}, again${id}, text${id}, old${id}, shown${id}, also${id}, source${id}.count${id}, source${id}["a text ${id}"], reads${id}());`,
        () => `note("step", step${id}(), count${id}, source${id}.count${id});`,
        () =>
          `{\nconst early = () => [count${id}, source${id}.old${id}];\nstep${id}();\nnote("a closure made ahead", early());\n}`,
        () => `for (let turn = 0; turn < 3; turn++) {\nstep${id}();\nnote("in a loop", count${id});\n}`,
        () => `replace${id}();\nnote("replaced", act${id}(), Kind${id}, source${id}.act${id}(), count${id}, old${id});`,
        () => `await later${id}();\nnote("later", count${id}, source${id}.count${id});`,
        () => `note("${space}", ${space});`,
        () =>
          `note("keys of ${space}", Reflect.ownKeys(${space}), Object.keys(${space}).length, JSON.stringify(Object.keys({ ...${space} })));`,
        () =>
          `note("about ${space}", Object.getPrototypeOf(${space}), ${space}[Symbol.toStringTag], Object.isFrozen(${space}), Object.isSealed(${space}), Object.isExtensible(${space}), typeof ${space}, String(Object.prototype.toString.call(${space})));`,
        () =>
          `note("attributes in ${space}", Reflect.ownKeys(${space}).slice(0, 3).map(key => JSON.stringify(Object.getOwnPropertyDescriptor(${space}, key), (name, each) => (typeof each === "function" ? "function" : each))));`,
        () =>
          `attempt("delete from ${space}", () => [Reflect.deleteProperty(${space}, "absent"), Reflect.deleteProperty(${space}, "shared"), Reflect.deleteProperty(${space}, Symbol.toStringTag)]);`,
        () =>
          `attempt("define on ${space}", () => [Reflect.defineProperty(${space}, "more", { value: 1 }), Reflect.set(${space}, "shared", 1), Reflect.setPrototypeOf(${space}, null), Reflect.setPrototypeOf(${space}, {}), Reflect.preventExtensions(${space})]);`,
        () =>
          `note("in ${space}", "shared" in ${space}, "default" in ${space}, "absent" in ${space}, "count${id}" in ${space}, Symbol.toStringTag in ${space}, Object.hasOwn(${space}, "shared"), ${space}.shared, ${space}.absent);`,
        () =>
          `note("the same namespace", (await import("./${space}.js")) === ${space}, (await import("./${space}.js")).shared === ${space}.shared);`,
        () =>
          `{\nconst key = ${random.pick([`"count${id}"`, '"shared"', '"default"', '"absent"', '"then"'])};\nnote("under a key", ${space}[key], source${id}[key]);\n}`,
        () =>
          `{\nconst { count${id}: taken, shared } = source${id};\nstep${id}();\nnote("taken apart", taken, shared, source${id}.count${id});\n}`,
      ])(),
    );
  }

  // Two files that need each other.
  if (random.chance(0.6)) {
    const kind = random.pick(["const", "let", "class", "function", "var"]);
    const declared =
      kind === "class"
        ? `export class late {}`
        : kind === "function"
          ? `export function late() {\nreturn "late";\n}`
          : `export ${kind} late = "late";`;
    files["first.js"] =
      `${top}import { early, readsLate } from "./second.js";\nnote("runs first");\nattempt("first reads early", () => early);\n${declared}\nattempt("second reads late, behind", () => readsLate());\n`;
    files["second.js"] =
      `${top}import * as first from "./first.js";\nimport { late } from "./first.js";\nnote("runs second");\nattempt("second reads late, ahead", () => typeof late);\nattempt("second reads the namespace, ahead", () => typeof first.late);\nattempt("second lists the namespace, ahead", () => Object.keys(first));\nattempt("second asks the namespace, ahead", () => "late" in first);\nexport const early = "early";\nexport const readsLate = () => typeof late;\n`;
    rows.push(`await import("./first.js");`);
  }
  return {
    text: `import { note, attempt, lines } from "./notes.js";\n${imports.join("\n")}\n${rows.join("\n")}\nconsole.log(lines.join("\\n"));\n`,
    files,
  };
}
