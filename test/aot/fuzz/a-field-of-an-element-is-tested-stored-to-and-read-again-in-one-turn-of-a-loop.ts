// In one turn of a loop that walks a list of rows, a field of an element is tested, that field or the element is stored to, and the field is read again: `if (rows[i].value === 100) rows[i].value = 3; s += rows[i].value;`.
// Every function sees rows that were made in one way alone, of four lengths.
// `generate()` draws. `programOf()` walks every kind of field x every way to make the rows x every loop, untyped and typed, each program with every turn.
import { Random } from "./random";

const isMarked = (index: number) => index % 3 === 1 || index % 7 === 4;

// The kinds of field: how the value at an index is written, the marked value, what is stored, another thing that is stored, the type, where the sum starts.
type Kind = {
  at: (k: number) => string;
  marked: string;
  stored: string;
  other: string;
  type: string;
  start: string;
  read?: (e: string) => string;
};
const kinds: Record<string, Kind> = {
  whole: {
    at: k => (isMarked(k) ? "100" : String(k + 1)),
    marked: "100",
    stored: "3",
    other: "7",
    type: "number",
    start: "0",
  },
  fraction: {
    at: k => (isMarked(k) ? "100.5" : k + 1 + ".25"),
    marked: "100.5",
    stored: "3.5",
    other: "7.75",
    type: "number",
    start: "0",
  },
  wholeThenFraction: {
    at: k => (isMarked(k) ? "100" : String(k + 1)),
    marked: "100",
    stored: "0.5",
    other: "7",
    type: "number",
    start: "0",
  },
  text: {
    at: k => (isMarked(k) ? '"hit"' : `"t${k}"`),
    marked: '"hit"',
    stored: '"three"',
    other: '"seven"',
    type: "string",
    start: '""',
  },
  flag: {
    at: k => (isMarked(k) ? "true" : "false"),
    marked: "true",
    stored: "false",
    other: "true",
    type: "boolean",
    start: "0",
  },
  object: {
    at: k => (isMarked(k) ? "hit" : `{ n: ${k + 1} }`),
    marked: "hit",
    stored: "three",
    other: "seven",
    type: "{ n: number }",
    start: "0",
    read: e => `${e}.n`,
  },
};

const values = (kind: Kind, n: number) => Array.from({ length: n }, (_, k) => kind.at(k));
const asJSON = (kind: Kind) => kind !== kinds.object;
const makersFor = (typed: boolean): Record<string, (kind: Kind, n: number) => string | null> => ({
  literal: (kind, n) =>
    `[${values(kind, n)
      .map(v => `{ value: ${v} }`)
      .join(", ")}]`,
  literalOfTwoFields: (kind, n) =>
    `[${values(kind, n)
      .map((v, k) => `{ id: ${k}, value: ${v} }`)
      .join(", ")}]`,
  mapped: (kind, n) => `[${values(kind, n).join(", ")}].map(v => ({ value: v }))`,
  mappedFromParsed: (kind, n) =>
    asJSON(kind)
      ? `(JSON.parse(${JSON.stringify(`[${values(kind, n).join(",")}]`)})${typed ? ` as ${kind.type}[]` : ""}).map(${typed ? `(v: ${kind.type})` : "v"} => ({ value: v }))`
      : null,
  parsed: (kind, n) =>
    asJSON(kind)
      ? `JSON.parse(${JSON.stringify(
          `[${values(kind, n)
            .map(v => `{"value":${v}}`)
            .join(",")}]`,
        )})${typed ? " as Row[]" : ""}`
      : null,
  pushed: (kind, n) =>
    `(() => { const l${typed ? ": Row[]" : ""} = []; for (const v of [${values(kind, n).join(", ")}]) l.push({ value: v }); return l; })()`,
  ofAClass: (kind, n) => `[${values(kind, n).join(", ")}].map(v => new RowClass(v))`,
  ofAClassPushed: (kind, n) =>
    `(() => { const l${typed ? ": RowClass[]" : ""} = []; for (const v of [${values(kind, n).join(", ")}]) l.push(new RowClass(v)); return l; })()`,
  byAFunction: (kind, n) => `[${values(kind, n).join(", ")}].map(makeRow)`,
  from: (kind, n) => `Array.from([${values(kind, n).join(", ")}], v => ({ value: v }))`,
  inner: (kind, n) =>
    `[${values(kind, n)
      .map(v => `{ inner: { value: ${v} } }`)
      .join(", ")}]`,
});

// F(e) is the field of the row e.
type Parts = {
  F: (e: string) => string;
  M: string;
  V: string;
  W: string;
  R: (e: string) => string;
  make: (v: string) => string;
};
const turns: Record<string, (parts: Parts) => string> = {
  throughTheList: ({ F, M, V, R }) => `if (${F("rows[i]")} === ${M}) { ${F("rows[i]")} = ${V}; } ${R(F("rows[i]"))}`,
  throughAName: ({ F, M, V, R }) => `const row = rows[i]; if (${F("row")} === ${M}) ${F("row")} = ${V}; ${R(F("row"))}`,
  testedThroughAName: ({ F, M, V, R }) =>
    `const row = rows[i]; if (${F("row")} === ${M}) ${F("rows[i]")} = ${V}; ${R(F("row"))}`,
  storedThroughAName: ({ F, M, V, R }) =>
    `const row = rows[i]; if (${F("rows[i]")} === ${M}) ${F("row")} = ${V}; ${R(F("rows[i]"))}`,
  underAnotherName: ({ F, M, V, R }) => `if (${F("rows[i]")} === ${M}) ${F("same[i]")} = ${V}; ${R(F("rows[i]"))}`,
  atAnotherIndex: ({ F, M, V, R }) => `if (${F("rows[i]")} === ${M}) ${F("rows[j]")} = ${V}; ${R(F("rows[i]"))}`,
  inBothArms: ({ F, M, V, W, R }) =>
    `if (${F("rows[i]")} === ${M}) ${F("rows[i]")} = ${V}; else ${F("rows[i]")} = ${W}; ${R(F("rows[i]"))}`,
  inOtherArm: ({ F, M, V, R }) =>
    `if (${F("rows[i]")} !== ${M}) count++; else ${F("rows[i]")} = ${V}; ${R(F("rows[i]"))}`,
  and: ({ F, M, V, R }) => `${F("rows[i]")} === ${M} && (${F("rows[i]")} = ${V}); ${R(F("rows[i]"))}`,
  conditional: ({ F, M, V, R }) =>
    `${R(`(${F("rows[i]")} === ${M} ? (${F("rows[i]")} = ${V}) : ${F("rows[i]")})`)} ${R(F("rows[i]"))}`,
  keptBefore: ({ F, M, V, R }) =>
    `const before = ${F("rows[i]")}; if (before === ${M}) ${F("rows[i]")} = ${V}; ${R(F("rows[i]"))} ${R("before")}`,
  twoTests: ({ F, M, V, W, R }) =>
    `if (${F("rows[i]")} === ${M}) ${F("rows[i]")} = ${V}; if (${F("rows[i]")} === ${V}) ${F("rows[i]")} = ${W}; ${R(F("rows[i]"))}`,
  theRowIsReplaced: ({ F, M, V, R, make }) => `if (${F("rows[i]")} === ${M}) rows[i] = ${make(V)}; ${R(F("rows[i]"))}`,
  theRowIsSwapped: ({ F, M, R }) =>
    `if (${F("rows[i]")} === ${M}) { const k = rows.length - 1 - i; const t = rows[i]; rows[i] = rows[k]; rows[k] = t; } ${R(F("rows[i]"))}`,
  byAFunction: ({ F, M, V, R }) => `if (${F("rows[i]")} === ${M}) put(rows[i], ${V}); ${R(F("rows[i]"))}`,
  goesOn: ({ F, M, V, R }) =>
    `if (${F("rows[i]")} !== ${M}) { ${R(F("rows[i]"))} continue; } ${F("rows[i]")} = ${V}; ${R(F("rows[i]"))}`,
};

const loops: Record<string, (body: string) => string> = {
  up: body => `for (let i = 0; i < rows.length; i++) { ${body} }`,
  upToKeptLength: body => `for (let i = 0, n = rows.length; i < n; i++) { ${body} }`,
  whileLoop: body => `let i = -1; while (++i < rows.length) { ${body} }`,
  besideForOf: body => `let i = -1; for (const element of rows) { i++; ${body} }`,
  down: body => `for (let i = rows.length - 1; i >= 0; i--) { ${body} }`,
  byTwo: body => `for (let i = 0; i < rows.length; i += 2) { ${body} }`,
};

function textOf(
  typed: boolean,
  kindName: string,
  makerName: string,
  chosen: readonly { turn: string; loop: string }[],
) {
  const kind = kinds[kindName];
  const make = makersFor(typed)[makerName];
  const isInner = makerName === "inner";
  const isClass = makerName.startsWith("ofAClass");
  const hasId = makerName === "literalOfTwoFields";
  const F = (e: string) => (isInner ? `${e}.inner.value` : `${e}.value`);
  const rowType = isClass ? "RowClass" : "Row";
  const makeRow = (v: string) => (isClass ? `new RowClass(${v})` : isInner ? `{ inner: { value: ${v} } }` : hasId ? `{ id: -1, value: ${v} }` : `{ value: ${v} }`); // prettier-ignore
  const read = kind.read ?? ((e: string) => e);
  const R = kind.type === "boolean" ? (e: string) => `s += ${e} ? 1 : 10;` : (e: string) => `s += ${read(e)};`;
  const T = kind.type;
  let text = "";
  if (typed)
    text += `type Row = ${isInner ? `{ inner: { value: ${T} } }` : hasId ? `{ id: number; value: ${T} }` : `{ value: ${T} }`};\n`;
  text += typed
    ? `class RowClass { value: ${T}; constructor(value: ${T}) { this.value = value; } }\n`
    : `class RowClass { constructor(value) { this.value = value; } }\n`;
  if (kind === kinds.object) text += `const hit = { n: 100 }, three = { n: 3 }, seven = { n: 7 };\n`;
  text += `function makeRow(value${typed ? `: ${T}` : ""})${typed ? ": Row" : ""} { return ${isInner ? "{ inner: { value } }" : hasId ? "{ id: 0, value }" : "{ value }"}; }\n`;
  text += `function put(row${typed ? `: ${rowType}` : ""}, value${typed ? `: ${T}` : ""}) { ${F("row")} = value; }\n`;
  for (const [at, { turn, loop }] of chosen.entries()) {
    const name = `f${at}`;
    const label = `${name} ${kindName} ${makerName} ${turn} ${loop}`;
    const body = turns[turn]({ F, M: kind.marked, V: kind.stored, W: kind.other, R, make: makeRow });
    text += `function ${name}(rows${typed ? `: ${rowType}[]` : ""}, same${typed ? `: ${rowType}[]` : ""}, j${typed ? ": number" : ""}) { let s = ${kind.start}; let count = 0; ${loops[loop](body)} return s + " " + count; }\n`;
    for (const n of [1, 3, 8, 21])
      text += `{ const list${typed ? `: ${rowType}[]` : ""} = ${make(kind, n)}; console.log(${JSON.stringify(`${label} ${n}`)}, ${name}(list, list, ${n >> 1}), JSON.stringify(list)); }\n`;
  }
  return text + (typed ? "export {};\n" : "");
}

const crossed = [false, true].flatMap(isTyped =>
  Object.keys(loops).flatMap(loop =>
    Object.keys(kinds).flatMap(kind =>
      Object.keys(makersFor(isTyped))
        .filter(maker => makersFor(isTyped)[maker](kinds[kind], 1) !== null)
        .map(maker => ({ isTyped, kind, maker, loop })),
    ),
  ),
);
export const programs = crossed.length;

export function programOf(index: number): { file: string; text: string } {
  const { isTyped, kind, maker, loop } = crossed[index];
  return {
    file: isTyped ? "main.ts" : "main.mjs",
    text: textOf(isTyped, kind, maker, Object.keys(turns).map(turn => ({ turn, loop }))), // prettier-ignore
  };
}

export function generate(random: Random, isTyped: boolean): string {
  const { kind, maker } = random.pick(crossed.filter(cross => cross.isTyped === isTyped));
  return textOf(isTyped, kind, maker, Array.from({ length: random.between(4, 20) }, () => ({ turn: random.pick(Object.keys(turns)), loop: random.pick(Object.keys(loops)) }))); // prettier-ignore
}
