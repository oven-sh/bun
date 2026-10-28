// A list is cut into rows. The outer loop goes on while its counter is below the length of the list, and the counter is set from the counter of the loop inside: each turn takes up where the
// last row ended. Each case is one function of the file, called from the file's own code, and prints what plain Bun prints.
// The table: where the length is read x what stands between the head of the outer loop and the inner loop x how the inner loop is left x what is done with the row x what the list holds x what
// the function is called with.
//
//   bun loops-whose-counter-is-set-from-the-loop-inside.ts <folder> [--typed] [--sample=<how many>] [--only=<regex over names>]
//
// writes <folder>/rows-<what is done with the row>-<what the list holds>.mjs, with --typed .ts.
import { writeCaseFiles, type CaseFile } from "./case-files";

const lengths = [
  { name: "length-read-once", declare: "const count = list.length;", count: "count" },
  { name: "length-read-every-time", declare: "", count: "list.length" },
];

/** `E(..)` stands for the element at an index, `N` for the length. Each leaves `next` behind `first`. */
const between = [
  { name: "a-loop-that-tests-last", text: "do total = E(next++); while (!total && next < N);" },
  { name: "one-read", text: "total = E(next++);" },
  { name: "a-loop-that-tests-first", text: "while (next < N - 1 && !E(next)) next++; total = E(next++);" },
];

const exits = [
  { name: "left-by-break", text: "if (total > limit) { total -= value; break; }" },
  {
    name: "left-by-break-behind-a-store",
    text: "if (total > limit) { total -= value; rows.length = rows.length; break; }",
  },
  { name: "left-at-its-end", text: "if (total > limit) { total -= value; limit += value; }" },
];

/** `W` stands for the number of the case. */
const rowUses = [
  { name: "kept", text: "rows.push(list.slice(first, next));", helpers: "" },
  {
    name: "walked",
    text: "const row = list.slice(first, next); rows.push(row); for (let i = 0; i < row.length; i++) sum += E2(row, i) * (i + 1);",
    helpers: "",
  },
  {
    name: "walked-by-one-of-two-functions",
    text: "const row = { total, isEven: (total & 1) === 0, parts: list.slice(first, next) }; rows.push(row.parts); if (row.isEven) sum += upW(row, first); else sum += downW(row, first);",
    helpers:
      "function upW(rowT1, startT2)T3 { const parts = row.parts; let sum = start; for (let i = 0; i < parts.length; i++) sum += E2(parts, i) * (i + 1); return sum; } function downW(rowT1, startT2)T3 { const parts = row.parts; let sum = start, i = -1; const count = parts.length; while (++i < count) sum -= E2(parts, i); return sum; }",
  },
  { name: "only-counted", text: "rows.push(next - first);", helpers: "" },
];

const elements = [
  {
    name: "numbers",
    read: (list: string, index: string) => `${list}[${index}]`,
    type: "number",
    wrap: (value: string) => value,
  },
  {
    name: "fields-of-objects",
    read: (list: string, index: string) => `${list}[${index}].weight`,
    type: "{ weight: number }",
    wrap: (value: string) => `{ weight: ${value} }`,
  },
];

const calls = [
  { name: "one-call", of: [["6", "3", "1"]] },
  {
    name: "several-calls",
    of: [["6", "3", "1"], [], ["1"], ["0", "0", "5", "1", "1", "9", "2", "0"], ["4", "4", "4", "4", "4", "4"]],
  },
  {
    name: "fractions-too",
    of: [
      ["6", "3", "1"],
      ["0.5", "2.5", "7.25", "0", "1"],
    ],
  },
];

const withElements = (text: string, read: (list: string, index: string) => string) =>
  text
    .replace(/E2\((\w+), (\w+)\)/g, (_, list, index) => read(list, index))
    .replace(/E\(([^()]+)\)/g, (_, index) => read("list", index));

const head = (isTyped: boolean) =>
  `// A list is cut into rows: the counter of the outer loop is set from the counter of the loop inside.
function t(name${isTyped ? ": string" : ""}, answers${isTyped ? ": unknown[]" : ""}) {
  console.log(name + ": " + JSON.stringify(answers));
}
`;

export function caseFiles(isTyped: boolean): CaseFile[] {
  let number = 0;
  return rowUses.flatMap(use =>
    elements.map(element => ({
      name: `rows-${use.name}-${element.name}.${isTyped ? "ts" : "mjs"}`,
      head: head(isTyped),
      cases: lengths.flatMap(length =>
        between.flatMap(front =>
          exits.flatMap(exit =>
            calls.map(call => {
              const f = `f${number}`;
              const types = isTyped
                ? {
                    T1: `: { total: number; isEven: boolean; parts: ${element.type}[] }`,
                    T2: ": number",
                    T3: ": number",
                  }
                : { T1: "", T2: "", T3: "" };
              const fill = (text: string) =>
                withElements(text, element.read)
                  .replaceAll("N", length.count)
                  .replaceAll("W", String(number))
                  .replace(/T[123]/g, word => types[word as keyof typeof types]);
              const text =
                fill(use.helpers) +
                ` function ${f}(list${isTyped ? `: ${element.type}[]` : ""}, limit${isTyped ? ": number" : ""}) { const rows${isTyped ? ": unknown[]" : ""} = []; ${length.declare} let first = 0, next = 0, total = 0, value = 0, sum = 0; while (first < ${length.count}) { ` +
                fill(front.text) +
                ` for (; next < ${length.count}; ++next) { total += value = ${element.read("list", "next")}; ${fill(exit.text)} } ` +
                fill(use.text) +
                ` sum += total; first = next; } return [rows, sum, first]; }`;
              number++;
              const name = [use.name, element.name, length.name, front.name, exit.name, call.name].join(" ");
              const runs = call.of.map(values => `${f}([${values.map(element.wrap).join(", ")}], 8)`);
              return { name, line: `t(${JSON.stringify(name)}, [${runs.join(", ")}]); ${text.trim()}` };
            }),
          ),
        ),
      ),
    })),
  );
}

if (import.meta.main) writeCaseFiles(caseFiles(process.argv.includes("--typed")));
