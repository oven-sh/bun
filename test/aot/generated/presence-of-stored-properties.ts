// A property that a function has just stored on an object it made is there, whatever kind of value was stored and whoever asks. Each case makes an object, stores under the key `n` what it reads from a row, and asks for the property.
// The table: how the property is stored x where the rows come from x who asks. How the function is called rotates, so every pair of the other axes meets several callers.
//
//   bun presence-of-stored-properties.ts <folder> [--typed] [--sample=<how many>] [--only=<regex over names>]
//
// writes <folder>/stored-<store>.mjs, with --typed .ts.
import { writeCaseFiles, type CaseFile } from "./case-files";

interface Store {
  name: string;
  /** Defines `o` and stores to it. What stands in `@{}` is written in the typed form alone. */
  text: string;
  /** It adds to the value, which a symbol and a bigint refuse. */
  adds?: true;
}

const stores: Store[] = [
  { name: "plain", text: "const o@{: O} = {}; o.n = row.n;" },
  { name: "sum", text: "const o@{: O} = {}; o.n = row.n + 1;", adds: true },
  { name: "conditional", text: "const o@{: O} = {}; if (row.n) o.n = row.n;" },
  { name: "behind-another", text: "const o@{: O} = {}; o.id = row.id; if (row.n) o.n = row.n;" },
  {
    name: "either-arm",
    text: `const o@{: O} = {}; if (typeof row.n === "number") o.n = row.n; else if (row.n !== undefined) o.n = row.n;`,
  },
  { name: "computed", text: `const key = ["n"][0]; const o@{: O} = {}; o[key] = row.n;` },
  { name: "constant-key", text: `const o@{: O} = {}; o["n"] = row.n;` },
  { name: "compound", text: "const o@{: O} = {}; o.n = 1; o.n += row.n;", adds: true },
  { name: "if-nullish", text: "const o@{: O} = {}; o.n ??= row.n;" },
  { name: "loop", text: "const o@{: O} = {}; for (let i = 0; i < 2; i++) o.n = row.n;" },
  { name: "loop-from-the-second-turn", text: "const o@{: O} = {}; for (let i = 0; i < 2; i++) if (i) o.n = row.n;" },
  { name: "over-a-literal", text: "const o@{: O} = { n: 0 }; o.n = row.n;" },
  { name: "deleted-and-stored", text: "const o@{: O} = { n: 0 }; delete o.n; if (row.n) o.n = row.n;" },
  { name: "class-field", text: "const o = new Box(); if (row.n) o.n = row.n;" },
  { name: "constructor", text: "const o = new Filled(row.n);" },
  {
    name: "defined",
    text: `const o@{: O} = {}; Object.defineProperty(o, "n", { value: row.n, writable: true, enumerable: true, configurable: true });`,
  },
  { name: "assigned", text: "const o@{: O} = {}; Object.assign(o, row);" },
  { name: "spread", text: "const o@{: O} = { ...row };" },
];

interface Rows {
  name: string;
  text: string;
  /** Some hold a symbol or a bigint. */
  holdsWhatRefusesAddition?: true;
}

const parsed = (...values: string[]) =>
  `JSON.parse('[${values.map(value => (value ? `{"id":1,"n":${value}}` : `{"id":1}`)).join(",")}]')`;

const rows: Rows[] = [
  {
    name: "parsed-mixed",
    text: parsed(`"x"`, "1", `"a"`, "1.5", "true", "false", "null", `{"k":1}`, "[1]", "0", `""`, ""),
  },
  { name: "parsed-numbers-then-texts", text: parsed("1", "2", "3", `"x"`, `"a"`, "") },
  { name: "parsed-texts-then-numbers", text: parsed(`"x"`, `"a"`, "1", "2.5", "") },
  { name: "parsed-texts", text: parsed(`"x"`, `"a"`, "") },
  { name: "parsed-integers", text: parsed("1", "2", "") },
  { name: "parsed-fractions", text: parsed("1.5", "2.5", "") },
  { name: "parsed-booleans-and-null", text: parsed("true", "false", "null", "") },
  { name: "parsed-objects", text: parsed(`{"k":1}`, "[1]", "") },
  {
    name: "listed-mixed",
    text: `[{ id: 1, n: "x" }, { id: 1, n: 1 }, { id: 1, n: 1.5 }, { id: 1, n: true }, { id: 1, n: null }, { id: 1, n: undefined }, { id: 1, n: { k: 1 } }, { id: 1 }]`,
  },
  {
    name: "listed-symbols-and-bigints",
    text: `[{ id: 1, n: 1 }, { id: 1, n: 1n }, { id: 1, n: Symbol.iterator }, { id: 1, n: undefined }, { id: 1, n: "x" }, { id: 1 }]`,
    holdsWhatRefusesAddition: true,
  },
  {
    name: "made-from-entries",
    text: `["x", 1, 1.5, true, null, undefined, { k: 1 }].map(value => Object.fromEntries([["id", 1], ["n", value]]))`,
  },
  {
    name: "taken-out-of-a-map",
    text: `[...new Map([[0, { id: 1, n: "x" }], [1, { id: 1, n: 1 }], [2, { id: 1, n: 2n }], [3, { id: 1, n: Symbol.iterator }], [4, { id: 1, n: undefined }], [5, { id: 1 }]]@{ as [number, Row][]}).values()]`,
    holdsWhatRefusesAddition: true,
  },
];

interface Reader {
  name: string;
  /** Stands behind the stores and returns. */
  text: string;
  /** It writes the value as JSON, which a bigint refuses. */
  writesJson?: true;
}

const readers: Reader[] = [
  { name: "in", text: `return "n" in o;` },
  { name: "has-own", text: `return Object.hasOwn(o, "n");` },
  { name: "has-own-property", text: `return o.hasOwnProperty("n");` },
  { name: "has-own-property-called", text: `return Object.prototype.hasOwnProperty.call(o, "n");` },
  { name: "reflect-has", text: `return Reflect.has(o, "n");` },
  { name: "property-is-enumerable", text: `return o.propertyIsEnumerable("n");` },
  { name: "in-under-a-key", text: `const asked = ["n"][0]; return asked in o;` },
  { name: "keys", text: "return Object.keys(o).join();" },
  { name: "entries", text: "return Object.entries(o).length;" },
  { name: "values", text: "return Object.values(o).length;" },
  { name: "own-names", text: "return Object.getOwnPropertyNames(o).join();" },
  { name: "own-keys", text: "return Reflect.ownKeys(o).join();" },
  { name: "descriptor", text: `return Object.getOwnPropertyDescriptor(o, "n") !== undefined;` },
  { name: "for-in", text: `let names = ""; for (const name in o) names += name; return names;` },
  { name: "json", text: "return JSON.stringify(o);", writesJson: true },
  { name: "spread", text: "return Object.keys({ ...o }).join();" },
  { name: "assign", text: "return Object.keys(Object.assign({}, o)).join();" },
  { name: "rest", text: "const { ...others } = o; return Object.keys(others).join();" },
  { name: "read", text: "return String(o.n);" },
  { name: "compared-with-undefined", text: "return o.n === undefined;" },
  { name: "default-of-a-pattern", text: `const { n = "default" } = o; return String(n);` },
  { name: "value-where-in-finds-it", text: `return "n" in o ? String(o.n) : "lost";` },
  { name: "value-where-has-own-finds-it", text: `return Object.hasOwn(o, "n") ? String(o.n) : "lost";` },
  { name: "filled-where-in-finds-nothing", text: `if (!("n" in o)) o.n = "default"; return o;` },
  { name: "filled-where-has-own-finds-nothing", text: `if (!Object.hasOwn(o, "n")) o.n = "default"; return o;` },
  { name: "filled-where-nullish", text: `o.n ??= "default"; return o;` },
  { name: "in-twice-around-a-delete", text: `const before = "n" in o; delete o.n; return before + "/" + ("n" in o);` },
  { name: "in-and-the-object", text: `return ["n" in o, o];` },
];

const callers = [
  { name: "map", text: `return rows.map(f).map(show).join("|");` },
  {
    name: "for-each",
    text: `const shown@{: string[]} = []; rows.forEach(row => shown.push(show(f(row)))); return shown.join("|");`,
  },
  {
    name: "for-of",
    text: `const shown@{: string[]} = []; for (const row of rows) shown.push(show(f(row))); return shown.join("|");`,
  },
  {
    name: "by-index",
    text: `const shown@{: string[]} = []; for (let i = 0; i < rows.length; i++) shown.push(show(f(rows[i]))); return shown.join("|");`,
  },
  {
    name: "closure",
    text: `const later = (row@{: Row}) => () => f(row); return rows.map(row => show(later(row)())).join("|");`,
  },
  { name: "method", text: `const holder = { f }; return rows.map(row => show(holder.f(row))).join("|");` },
];

const head = `@{type Row = { id?: any; n?: any };
type O = { id?: any; n?: any; [key: string]: any };
}class Box {
  n@{?: any};
}
class Filled {
  n@{?: any};
  constructor(n@{: any}) {
    if (n) this.n = n;
  }
}
function show(result@{: any})@{: string} {
  if (Array.isArray(result)) return result.map(show).join("&");
  return typeof result === "object" && result !== null ? Object.keys(result).join() + "=" + String(result.n) : String(result);
}
function t(name@{: string}, run@{: () => string}) {
  console.log(name + ": " + run());
}
`;

export function caseFiles(isTyped: boolean): CaseFile[] {
  const written = (text: string) => text.replace(/@\{((?:[^{}]|\{[^{}]*\})*)\}/g, isTyped ? "$1" : "");
  return stores.map((store, storeIndex) => ({
    name: `stored-${store.name}.${isTyped ? "ts" : "mjs"}`,
    head: written(head),
    cases: rows.flatMap((from, rowsIndex) =>
      readers
        .filter(reader => !from.holdsWhatRefusesAddition || (!store.adds && !reader.writesJson))
        .map((reader, readerIndex) => {
          const caller = callers[(storeIndex + rowsIndex + readerIndex) % callers.length];
          const name = `${store.name} ${from.name} ${reader.name} ${caller.name}`;
          const body = `const rows@{: Row[]} = ${from.text}; function f(row@{: Row}) { ${store.text} ${reader.text} } ${caller.text}`;
          return { name, line: written(`t("${name}", () => { ${body} });`) };
        }),
    ),
  }));
}

if (import.meta.main) {
  const words = process.argv.slice(2);
  writeCaseFiles(
    caseFiles(words.includes("--typed")),
    words.filter(word => word !== "--typed"),
  );
}
