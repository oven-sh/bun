// One row that is not like the others, in a list that a short loop walks: the loop, times what it does with a row, times how the odd row differs, times where it stands, times how long the list is, times the
// road by which the list comes to the loop. Each program holds one of each and is built alone.
//
//   bun write-odd-row-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<loop>--<deed>--<odd row>--<place>--<length>--<road>.js
//   bun write-odd-row-sweep.ts count
//   bun write-odd-row-sweep.ts named <pattern> <folder> [most]
//
// A compiler that has seen rows of one shape lays several turns of a short loop out in a row, and each of those turns has to ask again what its own row is. A list is long enough for that from seventeen
// rows on. The function first walks a list of rows that are all alike, then a list with the odd row, and where the name of the program says so it is reached under a name that comes out of data, so that
// nobody can tell which lists it is given. Where the odd row stands comes out of the run.
import { mkdirSync, writeFileSync } from "fs";

// DEED is what is done with the row `rows[i]`, or `row`.
const loops: [string, string][] = [
  ["by-index", "for (let i = 0; i < rows.length; i++) {\n    const row = rows[i];\n    DEED\n  }"],
  ["by-index-written-in-place", "for (let i = 0; i < rows.length; i++) {\n    INPLACE\n  }"],
  [
    "by-index-to-a-length-read-once",
    "for (let i = 0, n = rows.length; i < n; i++) {\n    const row = rows[i];\n    DEED\n  }",
  ],
  ["backwards", "for (let i = rows.length - 1; i >= 0; i--) {\n    const row = rows[i];\n    DEED\n  }"],
  ["by-of", "for (const row of rows) {\n    DEED\n  }"],
  ["by-while", "let i = 0;\n  while (i < rows.length) {\n    const row = rows[i++];\n    DEED\n  }"],
  ["by-for-each", "rows.forEach(row => {\n    DEED\n  });"],
  ["every-second", "for (let i = 0; i < rows.length; i += 2) {\n    const row = rows[i];\n    DEED\n  }"],
];

const deeds: [string, string][] = [
  ["a-field-is-summed", "s += row.price;"],
  ["two-fields-are-summed", "s += row.price + row.id;"],
  ["a-field-is-joined", 's += "," + row.price;'],
  ["a-field-is-stored", "row.price = 3;\n    s += row.price;"],
  ["a-field-is-raised", "row.price += 1;\n    s += row.price;"],
  ["a-field-is-asked-for-its-kind", "s += typeof row.price;"],
];

// What makes the odd row. `i` is its place.
const oddRows: [string, string][] = [
  ["other-names-in-front", "({ cost: i, tax: 8, extra: 9, price: 1000 })"],
  ["the-names-the-other-way-round", "({ price: 1000, id: i })"],
  ["one-name-more", "({ id: i, price: 1000, more: 1 })"],
  ["the-field-is-a-getter", "({ id: i, get price() { return 1000; }, set price(to) {} })"],
  ["the-field-is-missing", "({ id: i })"],
  ["the-field-is-inherited", "Object.create({ price: 1000 }, { id: { value: i, enumerable: true } })"],
  ["the-field-is-a-fraction", "({ id: i, price: 0.5 })"],
  ["the-field-is-no-number", "({ id: i, price: NaN })"],
  ["the-field-is-minus-zero", "({ id: i, price: -0 })"],
  ["the-field-is-a-text", '({ id: i, price: "1000" })'],
  ["the-field-is-too-large-for-an-int32", "({ id: i, price: 4294967296 })"],
  ["the-row-has-no-prototype", "Object.assign(Object.create(null), { id: i, price: 1000 })"],
  ["the-row-is-frozen", "Object.freeze({ id: i, price: 1000 })"],
  ["the-row-is-an-instance", "new (class Row { constructor() { this.id = i; this.price = 1000; } })()"],
  ["the-row-is-a-list", "Object.assign([], { id: i, price: 1000 })"],
  ["the-row-is-a-proxy", "new Proxy({ id: i, price: 1000 }, {})"],
  ["a-name-was-deleted", "(o => (delete o.gone, o))({ gone: 1, id: i, price: 1000 })"],
  ["no-odd-row", "row(i)"],
];

// The place of the odd row in a list of LENGTH rows.
const places: [string, string][] = [
  ["first", "0"],
  ["the-eighth", "7"],
  ["the-ninth", "8"],
  ["the-tenth", "9"],
  ["last", "LENGTH - 1"],
];

const lengths: [string, number][] = [
  ["seventeen-rows", 17],
  ["ten-rows", 10],
  ["thirty-three-rows", 33],
  ["a-hundred-rows", 100],
];

const roads: [string, string, string][] = [
  [
    "under-a-name-out-of-data",
    "globalThis.kept = total;\nconst unseen = globalThis[JSON.parse('\"kept\"')];",
    "unseen(mixed)",
  ],
  ["called-by-name", "", "total(mixed)"],
];

const all = loops.length * deeds.length * oddRows.length * places.length * lengths.length * roads.length;

function write(at: number): { name: string; text: string } {
  const pick = <T>(list: readonly T[]): T => {
    const one = list[at % list.length];
    at = Math.floor(at / list.length);
    return one;
  };
  const [odd, made] = pick(oddRows);
  const [place, where] = pick(places);
  const [loop, shape] = pick(loops);
  const [deed, done] = pick(deeds);
  const [length, rows] = pick(lengths);
  const [road, found, called] = pick(roads);
  const starts = deed === "a-field-is-joined" || deed === "a-field-is-asked-for-its-kind" ? '""' : "0";
  const body = shape.replace("DEED", done).replace("INPLACE", done.replaceAll("row.", "rows[i]."));
  const text = [
    `function total(rows) {\n  let s = ${starts};\n  ${body}\n  return s;\n}`,
    found,
    "const row = i => ({ id: i, price: i * 2 });",
    `const turned = i => ${made};`,
    `const at = Number(process.argv[9] ?? ${where.replace("LENGTH", String(rows))});`,
    "const good = [];",
    `for (let i = 0; i < ${rows}; i++) good.push(row(i));`,
    'const mixed = JSON.parse("[]");',
    `for (let i = 0; i < ${rows}; i++) mixed.push(i === at ? turned(i) : row(i));`,
    `console.log(total(good), ${called});`,
  ]
    .filter(Boolean)
    .join("\n");
  return { name: `${loop}--${deed}--${odd}--${place}--${length}--${road}.js`, text: text + "\n" };
}

const pad = (at: number) => String(at).padStart(5, "0");
if (process.argv[2] === "count") console.log(all);
else if (process.argv[2] === "named") {
  const [pattern, folder, atMost] = [new RegExp(process.argv[3]), process.argv[4], Number(process.argv[5] ?? 500)];
  mkdirSync(folder, { recursive: true });
  let laid = 0;
  for (let at = 0; at < all && laid < atMost; at++) {
    const program = write(at);
    if (!pattern.test(program.name)) continue;
    writeFileSync(`${folder}/${pad(at)}-${program.name}`, program.text);
    laid++;
  }
  console.log(laid);
} else {
  const [folder, from, count, stride] = [process.argv[2], Number(process.argv[3] ?? 0), Number(process.argv[4] ?? all), Number(process.argv[5] ?? 1)]; // prettier-ignore
  mkdirSync(folder, { recursive: true });
  for (let step = 0; step < Math.min(count, all); step++) {
    const at = (from + step * stride) % all;
    const program = write(at);
    writeFileSync(`${folder}/${pad(at)}-${program.name}`, program.text);
  }
  console.log(Math.min(count, all));
}
