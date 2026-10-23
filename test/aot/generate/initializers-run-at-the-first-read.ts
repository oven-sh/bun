// An object that a top-level binding holds is filled through another name for it. Whoever reads the binding first, in its own module, in another one or in a circle of imports, finds it filled.
import { programsOf } from "../generate";

const names: Record<string, string> = {
  "a-condition": "const target = flag ? spare : table;",
  "two-conditions": "const target = flag ? spare : count > 5 ? spare : table;",
  "a-switch": "let target; switch (count) { case 1: target = spare; break; case 2: target = table; break; default: target = spare; }",
  "if-and-else": "let target; if (flag) target = spare; else target = table;",
  "an-if-that-stores-again": "let target = spare; if (!flag) target = table;",
  "or": "const target = (flag ? spare : undefined) || table;",
  "nullish": "const target = (flag ? spare : undefined) ?? table;",
  "and": "const target = (flag ? undefined : spare) && table;",
  "a-comma": "const target = (count, table);",
  "a-function-that-returns-its-argument": "const same = value => value; const target = same(table);",
  "a-function-that-chooses": "function choose(a, b) { return flag ? a : b; } const target = choose(spare, table);",
  "a-parameter": "const target = table; (filled => { filled.zero = zero; })(flag ? spare : table);",
  "the-object-function": "const target = Object(table);",
  "what-assign-returns": "const target = Object.assign(table, {});",
  "an-array-pattern": "const [target] = [table, spare];",
  "an-object-pattern": "const { target } = { target: table };",
  "an-element": "const target = [spare, table][flag ? 0 : 1];",
  "a-member-by-key": "const target = { a: spare, b: table }[flag ? 'a' : 'b'];",
  "try-and-finally": "let target; try { target = flag ? spare : table; } finally { count; }",
  "try-and-catch": "let target; try { if (flag) throw 1; target = table; } catch { target = spare; }",
  "the-last-turn-of-a-loop": "let target = spare; for (let i = 0; i < count; i++) target = i ? table : spare;",
  "a-loop-over-both": "let target = table; for (const each of [spare, table]) each.zero = zero;",
  "a-labeled-block": "let target = spare; pick: { if (flag) break pick; target = table; }",
  "a-second-binding": "const target = table;",
  "a-default-parameter": "const target = ((a = table) => a)();",
  "a-rest-parameter": "const target = ((...all) => all[flag ? 0 : 1])(spare, table);",
  "a-map": "const target = new Map([['k', table]]).get('k');",
  "a-static-field": "class Holder { static held = flag ? spare : table; } const target = Holder.held;",
  "a-static-block": "let target; class Holder { static { target = flag ? spare : table; } }",
  "a-generator": "const target = (function* () { yield table; })().next().value;",
  "a-test-of-a-type": "const target = typeof count === 'number' ? table : spare;",
};
const fills: Record<string, string> = {
  "stores": "target.one = one; target.two = two; target.three = three;",
  "assign": "Object.assign(target, { one, two, three });",
  "stores-by-key-in-a-loop": "for (const [key, value] of [['one', one], ['two', two], ['three', three]]) target[key] = value;",
};
const show = "value => Object.keys(value).join()";
const flags = "export const flag = process.argv.length > 100;\nexport const count = process.argv.length > 100 ? 7 : 2;\n";
const tables = (name: string, fill: string, head: string, tail: string) => `import { count, flag } from "./flags.js";
${head}export const table = {};
export const spare = {};
const zero = () => 0, one = () => 1, two = () => 2, three = () => 3;
${names[name]}
${fills[fill]}
export function called() { return zero() + one() + two() + three() + " " + typeof target; }
${tail}`;
const readers: Record<string, (name: string, fill: string) => Record<string, string>> = {
  "its-own-module": (name, fill) => ({
    "main.js": `// The module that holds the object reads it first.\nimport "./tables.js";\n`,
    "tables.js": tables(name, fill, "", `const show = ${show};\nconsole.log(show(table), "|", show(spare));\nconsole.log(called(), "|", show(table), "|", show(spare));\n`),
  }),
  "another-module": (name, fill) => ({
    "main.js": `// Another module reads the object first.\nimport { called, spare, table } from "./tables.js";\nconst show = ${show};\nconsole.log(show(table), "|", show(spare));\nconsole.log(called(), "|", show(table), "|", show(spare));\n`,
    "tables.js": tables(name, fill, "", ""),
  }),
  "a-circle-of-imports": (name, fill) => ({
    "main.js": `// A module that imports the one with the object, and is imported by it, reads the object first.\nimport "./tables.js";\n`,
    "reader.js": `import { spare, table } from "./tables.js";\nconst show = ${show};\nexport const shown = () => show(table) + " | " + show(spare);\n`,
    "tables.js": tables(name, fill, `import { shown } from "./reader.js";\n`, `console.log(shown());\nconsole.log(called(), "|", shown());\n`),
  }),
};

export const programs = () => {
  const files: Record<string, string> = {};
  for (const name in names)
    for (const fill in fills)
      for (const reader in readers) {
        const folder = `filled-through-${name}-by-${fill}-and-read-first-by-${reader}`;
        files[`${folder}/flags.js`] = flags;
        for (const [file, text] of Object.entries(readers[reader](name, fill))) files[`${folder}/${file}`] = text;
      }
  return programsOf(files);
};
