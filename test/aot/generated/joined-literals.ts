// Programs in which several objects whose `value` holds different kinds of things (a double, an integer, a string, an array, an
// object, a function, null, undefined) are joined by TypeScript into one type: a union of up to four members, one normalized type
// from five on. "Assignable to that type" does not mean "laid out like it", and each program reads the objects back in one way.
//
// A program is a set of values, a form (what the objects are: plain literals, literals with other members beside `value`, instances
// of classes) and a way (how the objects are kept and read). Some ways are also written across two files.
const values = ["undefined", "null", "3.14", "{}", '["hi"]', "7", '"s"', "true", "{ n: 1 }", "() => 1", "-0.5", "[1.5, 2.5]"];

export const sets: Record<string, number[]> = {
  five: [0, 1, 2, 3, 4],
  four: [0, 1, 2, 3],
  seven: [2, 5, 6, 7, 8, 4, 1],
  numbers: [2, 5, 10, 2, 5, 10],
  six_no_nil: [2, 6, 3, 4, 8, 9],
  two: [2, 4],
  arrays: [4, 11, 2, 6, 0, 3],
  exactly4: [2, 6, 4, 8],
  exactly5: [2, 6, 4, 8, 7],
  exactly6: [2, 6, 4, 8, 7, 9],
};
// The other sets come only as plain literals, with and without a second member.
const setsInEveryForm = ["five", "four", "exactly4", "exactly5", "exactly6", "two"];

const literals = (set: number[], withMore = false) => set.map((v, i) => `{ value: ${values[v]}${withMore ? `, k: ${i}` : ""} }`);

/** What is declared ahead of the objects, and the expressions that make them. */
type Form = { ahead: string; objects: string[] };

function forms(set: number[]): Record<string, Form> {
  const next = (i: number) => values[set[(i + 1) % set.length]];
  const instances = set.map((_, i) => `new C${i}()`);
  return {
    "": { ahead: "", objects: literals(set) },
    _k: { ahead: "", objects: literals(set, true) },
    _optional: { ahead: "", objects: set.map((v, i) => `{ value: ${values[v]}${i % 2 ? `, extra: ${i}` : ""} }`) },
    _two_differ: { ahead: "", objects: set.map((v, i) => `{ value: ${values[v]}, other: ${next(i)} }`) },
    _other_first: {
      ahead: "",
      objects: set.map((v, i) => (i % 2 ? `{ other: ${next(i)}, value: ${values[v]} }` : `{ value: ${values[v]}, other: ${next(i)} }`)),
    },
    _three_orders: {
      ahead: "",
      objects: set.map(
        (v, i) =>
          [`{ name: "n${i}", value: ${values[v]}, flag: false }`, `{ value: ${values[v]}, flag: true, name: "n${i}" }`, `{ flag: false, name: "n${i}", value: ${values[v]} }`][i % 3],
      ),
    },
    _same_value_three_orders: {
      ahead: "",
      objects: set.map((_, i) => [`{ name: "n${i}", value: null, flag: false }`, `{ value: "v", flag: true, name: "n${i}" }`, `{ flag: false, name: "n${i}", value: "w" }`][i % 3]),
    },
    _kind: { ahead: "", objects: set.map((v, i) => `{ kind: "k${i}" as const, value: ${values[v]} }`) },
    _classes: { ahead: set.map((v, i) => `class C${i} { value = ${values[v]} }\n`).join(""), objects: instances },
    _class_and_literals: { ahead: `class C0 { value = ${values[set[0]]} }\n`, objects: ["new C0()", ...literals(set).slice(1)] },
    _heirs: { ahead: "class B { tag = 1 }\n" + set.map((v, i) => `class C${i} extends B { value = ${values[v]} }\n`).join(""), objects: instances },
  };
}

const head =
  "declare const console: { log(...values: unknown[]): void };\n" +
  'function show(v: unknown): string { return typeof v === "function" ? "fn" : Array.isArray(v) ? "[" + v.join() + "]" : v !== null && typeof v === "object" ? JSON.stringify(v) : String(v) }\n';

function ways(objects: string[]): Record<string, string> {
  const n = objects.length;
  const all = objects.join(", ");
  const rows = `const rows = [${all}];\n`;
  const lines = (line: (object: string, i: number) => string, of = objects) => of.map(line).join("\n");
  const list = (item: (object: string, i: number) => string) => objects.map(item).join(", ");
  const last = objects[n - 1];
  const chain = [...objects.slice(0, -1).map((object, i) => `i === ${i} ? ${object}`), last].join(" : ");
  const members = list((object, i) => `p${i}: ${object}`);
  const returns = lines((object, i) => `  if (i === ${i}) return ${object};`, objects.slice(0, -1));
  return {
    for_of: rows + "for (const row of rows) console.log(show(row.value));",
    index: rows + "for (let i = 0; i < rows.length; i++) console.log(show(rows[i].value));",
    index_bang: rows + "for (let i = 0; i < rows.length; i++) { const r = rows[i]!; console.log(show(r.value)); }",
    taken_apart: rows + `const [${list((_, i) => `r${i}`)}] = rows;\n` + lines((_, i) => `console.log(show(r${i}.value));`),
    pattern: rows + "for (const { value } of rows) console.log(show(value));",
    map: rows + 'console.log(rows.map(r => show(r.value)).join(" "));',
    for_each: rows + "rows.forEach(r => console.log(show(r.value)));",
    pushed: "const rows = [];\n" + lines(object => `rows.push(${object});`) + "\nfor (const row of rows) console.log(show(row.value));",
    let_array: `let rows = [${all}];\nfor (const row of rows) console.log(show(row.value));`,
    in_a_function: `function all() { const rows = [${all}]; let s = ""; for (const row of rows) s += show(row.value) + " "; return s }\nconsole.log(all());`,
    returned: `function make() { return [${all}] }\nfor (const row of make()) console.log(show(row.value));`,
    handed_on: rows + "function read(list: typeof rows) { for (const row of list) console.log(show(row.value)) }\nread(rows);",
    result: `function pick(i: number) {\n${returns}\n  return ${last};\n}\nfor (let i = 0; i < ${n}; i++) console.log(show(pick(i).value));`,
    conditional: `for (let i = 0; i < ${n}; i++) { const r = ${chain}; console.log(show(r.value)); }`,
    let_assigned: `function at(i: number) { let r = ${chain}; return r }\nfor (let i = 0; i < ${n}; i++) console.log(show(at(i).value));`,
    map_values:
      `const m = new Map([${list((object, i) => `[${i}, ${object}]`)}]);\nfor (let i = 0; i < ${n}; i++) console.log(show(m.get(i)!.value));\n` +
      "for (const r of m.values()) console.log(show(r.value));\nfor (const [, r] of m) console.log(show(r.value));",
    set_values: `const s = new Set([${all}]);\nfor (const r of s) console.log(show(r.value));`,
    field: `function hold(i: number) { return { row: ${chain} } }\nfor (let i = 0; i < ${n}; i++) console.log(show(hold(i).row.value));`,
    class_field: `class H { row; constructor(i: number) { this.row = ${chain} } }\nfor (let i = 0; i < ${n}; i++) console.log(show(new H(i).row.value));`,
    table_values: `const table = { ${members} };\nfor (const r of Object.values(table)) console.log(show(r.value));`,
    table_keys: `const table = { ${members} };\nfor (const k of Object.keys(table) as (keyof typeof table)[]) console.log(show(table[k].value));`,
    spread_array: rows + "for (const row of [...rows]) console.log(show(row.value));",
    slice:
      rows +
      "for (const row of rows.slice()) console.log(show(row.value));\nfor (const row of rows.filter(r => r !== undefined)) console.log(show(row.value));\n" +
      "for (const row of rows.concat(rows)) console.log(show(row.value));",
    generic: "function nth<T>(xs: T[], i: number): T { return xs[i] }\n" + rows + `for (let i = 0; i < ${n}; i++) console.log(show(nth(rows, i).value));`,
    closures: rows + "const fs = rows.map(r => () => r.value);\nfor (const f of fs) console.log(show(f()));",
    generator: `function* g() {\n${lines(object => `  yield ${object};`)}\n}\nfor (const r of g()) console.log(show(r.value));`,
    awaited:
      `const rows = await Promise.all([${list(object => `Promise.resolve(${object})`)}]);\nfor (const r of rows) console.log(show(r.value));\n` +
      `async function one(i: number) { return ${chain} }\nfor (let i = 0; i < ${n}; i++) console.log(show((await one(i)).value));`,
    pairs: `const pairs = [${list((object, i) => `[${object}, ${i}] as const`)}];\nfor (const [r, i] of pairs) console.log(i, show(r.value));`,
    pairs_plain: `const pairs = [${list(object => `[${object}]`)}];\nfor (const [r] of pairs) console.log(show(r.value));`,
    nested: `const rows = [${list(object => `{ inner: ${object} }`)}];\nfor (const row of rows) console.log(show(row.inner.value));`,
    copied: rows + "for (const row of rows) { const c = { ...row }; console.log(show(c.value)); }",
    copied_more: rows + "for (const row of rows) { const c = { ...row, more: 1 }; console.log(show(c.value), c.more); }",
    stored_through: rows + "for (const row of rows) row.value = rows[(rows.indexOf(row) + 1) % rows.length].value;\nfor (const row of rows) console.log(show(row.value));",
    stored_by_index:
      rows + "const last = rows[rows.length - 1].value;\nfor (let i = 0; i < rows.length; i++) rows[i].value = last;\nfor (const row of rows) console.log(show(row.value));",
    element_replaced:
      rows +
      "const first = rows[0];\nfor (let i = 0; i + 1 < rows.length; i++) rows[i] = rows[i + 1];\nrows[rows.length - 1] = first;\nfor (const row of rows) console.log(show(row.value));",
    sorted:
      rows +
      "rows.reverse();\nfor (const row of rows) console.log(show(row.value));\n" +
      "console.log(show(rows.find(r => r.value !== undefined)!.value), show(rows.at(-1)!.value), show(rows.pop()!.value), show(rows.shift()!.value));",
    reduce: rows + 'console.log(rows.reduce((s, r) => s + show(r.value) + " ", ""));',
    typeof_narrowed:
      rows +
      'for (const row of rows) { const v = row.value; if (typeof v === "number") console.log(v + 1); else if (typeof v === "string") console.log(v + "!"); else console.log(show(v)); }',
    annotated: `type Row = { value: unknown };\nconst rows: Row[] = [${all}];\nfor (const row of rows) console.log(show(row.value));`,
    satisfies: `type Row = { value: unknown };\nconst rows = [${all}] satisfies Row[];\nfor (const row of rows) console.log(show(row.value));`,
    as_const: `const rows = [${all}] as const;\nfor (const row of rows) console.log(show(row.value));`,
    param_wide: "function read(r: { value: unknown }) { return show(r.value) }\n" + lines(object => `console.log(read(${object}));`),
    param_wide_var: "function read(r: { value: unknown }) { return show(r.value) }\n" + rows + "for (const row of rows) console.log(read(row));",
    param_element:
      rows + "function read(r: (typeof rows)[number]) { return show(r.value) }\nfor (const row of rows) console.log(read(row));\n" + lines((_, i) => `console.log(read(rows[${i}]));`),
    param_optional:
      rows + 'function read(r?: (typeof rows)[number]) { return r === undefined ? "none" : show(r.value) }\nconsole.log(read());\nfor (const row of rows) console.log(read(row));',
    param_default: rows + "function read(r = rows[0]) { return show(r.value) }\nconsole.log(read());\nfor (const row of rows) console.log(read(row));",
    rest: rows + `function all(...rs: typeof rows) { return rs.map(r => show(r.value)).join(" ") }\nconsole.log(all(...rows));\nconsole.log(all(rows[0], rows[${n - 1}]));`,
    result_wide: `function pick(i: number): { value: unknown } {\n${returns}\n  return ${last};\n}\nfor (let i = 0; i < ${n}; i++) console.log(show(pick(i).value));`,
    captured_let: rows + "let current = rows[0];\nconst read = () => show(current.value);\nfor (const row of rows) { current = row; console.log(read()); }",
    captured_in_loop:
      rows +
      "const later: (() => string)[] = [];\nfor (let i = 0; i < rows.length; i++) { const row = rows[i]; later.push(() => show(row.value)); }\nfor (const f of later) console.log(f());",
    thrown: rows + "for (const row of rows) { try { throw row; } catch (e) { console.log(show((e as (typeof rows)[number]).value)); } }",
    then: rows + "for (const row of rows) await Promise.resolve(row).then(r => console.log(show(r.value)));",
    async_generator: `async function* g() {\n${lines(object => `  yield ${object};`)}\n}\nfor await (const r of g()) console.log(show(r.value));`,
    record: `const table: Record<string, { value: unknown }> = { ${members} };\nfor (const k in table) console.log(k, show(table[k].value));`,
    entries: `const table = { ${members} };\nfor (const [k, r] of Object.entries(table)) console.log(k, show(r.value));`,
    from_entries:
      rows + 'const table = Object.fromEntries(rows.map((r, i) => ["p" + i, r] as const));\nfor (const k of Object.keys(table)) console.log(k, show(table[k].value));',
    array_from:
      rows +
      "for (const r of Array.from(rows)) console.log(show(r.value));\nfor (const r of Array.from(rows, x => x)) console.log(show(r.value));\n" +
      "for (const r of Array.of(...rows)) console.log(show(r.value));",
    flat: rows + "for (const r of [rows, rows].flat()) console.log(show(r.value));\nfor (const r of rows.flatMap(x => [x])) console.log(show(r.value));",
    arrays_of_arrays: `const grid = [${list(object => `[${object}]`)}];\nfor (const line of grid) for (const r of line) console.log(show(r.value));`,
    weak_map:
      rows + "const keys = rows.map(() => ({}));\nconst m = new WeakMap(keys.map((k, i) => [k, rows[i]] as const));\nfor (const k of keys) console.log(show(m.get(k)!.value));",
    getter: rows + "class H { i = 0; get row() { return rows[this.i] } }\nconst h = new H();\nfor (; h.i < rows.length; h.i++) console.log(show(h.row.value));",
    static_field: rows + "class H { static row = rows[0] }\nfor (const row of rows) { H.row = row; console.log(show(H.row.value)); }",
    or:
      rows +
      "function at(i: number) { return rows[i + 1] || rows[0] }\nfor (let i = 0; i < rows.length; i++) console.log(show(at(i).value));\n" +
      "function at2(i: number) { return rows[i + 1] ?? rows[0] }\nfor (let i = 0; i < rows.length; i++) console.log(show(at2(i).value));",
    optional_chain: rows + "for (let i = 0; i <= rows.length; i++) console.log(show(rows[i]?.value));",
    in_narrowed: rows + 'for (const row of rows) console.log("value" in row ? show(row.value) : "none");',
    keyed: rows + 'const key = ["val", "ue"].join("") as "value";\nfor (const row of rows) console.log(show(row[key]));',
    object_keys: rows + "for (const row of rows) console.log(Object.keys(row).join(), JSON.stringify(Object.values(row).map(show)));",
    json: rows + 'console.log(JSON.stringify(rows.map(r => typeof r.value === "function" ? "fn" : r)));',
    assign: rows + "for (const row of rows) { const c = Object.assign({}, row); console.log(show(c.value)); }",
    swap: rows + `[rows[0], rows[${n - 1}]] = [rows[${n - 1}], rows[0]];\nfor (const row of rows) console.log(show(row.value));`,
    while_shift: rows + "let r;\nwhile ((r = rows.shift()) !== undefined) console.log(show(r.value));",
  };
}

const waysAcrossTwoFiles = [
  "for_of",
  "index",
  "pattern",
  "map",
  "handed_on",
  "generic",
  "closures",
  "copied",
  "stored_through",
  "typeof_narrowed",
  "param_wide_var",
  "param_element",
  "captured_let",
  "thrown",
  "getter",
  "keyed",
  "swap",
];
const formsAcrossTwoFiles = ["", "_kind", "_classes", "_two_differ", "_three_orders"];

// TypeScript itself rejects a literal that has a member which the written type `{ value: unknown }` lacks, and a Map of instances of
// unrelated classes.
const waysWithAWrittenType = ["annotated", "param_wide", "record", "result_wide", "satisfies"];
const formsWithOtherMembers = ["_k", "_kind", "_optional", "_other_first", "_same_value_three_orders", "_three_orders", "_two_differ"];
const formsWithClasses = ["_classes", "_class_and_literals", "_heirs"];
const isRejectedByTypeScript = (form: string, way: string) =>
  (waysWithAWrittenType.includes(way) && formsWithOtherMembers.includes(form)) || (way === "map_values" && formsWithClasses.includes(form));

export type Program = { name: string; file: string; text: string; files?: Record<string, string> };

export function programs(): Program[] {
  const all: Program[] = [];
  for (const [set, indexes] of Object.entries(sets)) {
    for (const [form, { ahead, objects }] of Object.entries(forms(indexes))) {
      if (form !== "" && form !== "_k" && !setsInEveryForm.includes(set)) continue;
      const first = `const rows = [${objects.join(", ")}];\n`;
      for (const [way, text] of Object.entries(ways(objects))) {
        if (isRejectedByTypeScript(form, way)) continue;
        all.push({ name: `${set}${form}__${way}`, file: "main.ts", text: head + ahead + text + "\n" });
        if (waysAcrossTwoFiles.includes(way) && text.startsWith(first) && formsAcrossTwoFiles.includes(form)) {
          all.push({
            name: `${set}${form}__${way}__two_files`,
            file: "main.ts",
            text: 'import { rows } from "./rows";\n' + head + text.slice(first.length) + "\n",
            files: { "rows.ts": ahead + "export " + first },
          });
        }
      }
    }
  }
  return all;
}
