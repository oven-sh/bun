import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { GlobalRow } from "./bindgen-emit.ts";
import { writeIfNotChanged } from "./helpers.ts";
import { dependsOnRealm, keptAside, replacesBun, sameObject, tables, type Table } from "./web-globals.ts";

const words = (text = "") => text.split(/\s+/).filter(Boolean);
const u64 = (value: bigint) => BigInt.asUintN(64, value);

/** `StringImpl::hash()` of a name in ASCII, like `hashValue` in create_hash_table. */
function hashOf(name: string): number {
  const bytes = Buffer.from(name, "latin1");
  const length = bytes.length;
  const secret = [3257665815644502181n, 10067880064238660809n, 5418857496715711651n];
  const multiply = (a: bigint, b: bigint) => [u64(a * b), (a * b) >> 64n];
  const mix = (a: bigint, b: bigint) => multiply(a, b).reduce((low, high) => low ^ high);
  const read32 = (at: number) => BigInt(bytes.readUInt32LE(at));
  const read64 = (at: number) => bytes.readBigUInt64LE(at);
  let seed = mix(secret[0], secret[1]) ^ BigInt(length);
  let a: bigint, b: bigint;
  if (length > 48) throw new Error(`${name} is too long`);
  if (length > 16) {
    seed = mix(read64(0) ^ secret[2], read64(8) ^ seed ^ secret[1]);
    if (length > 32) seed = mix(read64(16) ^ secret[2], read64(24) ^ seed);
    [a, b] = [read64(length - 16), read64(length - 8)];
  } else if (length >= 4) {
    const delta = length >= 8 ? 4 : 0;
    [a, b] = [(read32(0) << 32n) | read32(length - 4), (read32(delta) << 32n) | read32(length - 4 - delta)];
  } else {
    [a, b] = [(BigInt(bytes[0]) << 56n) | (BigInt(bytes[length >> 1]) << 32n) | BigInt(bytes[length - 1]), 0n];
  }
  [a, b] = multiply(a ^ secret[1], b ^ seed);
  return Number(mix(a ^ secret[0] ^ BigInt(length), b ^ secret[1]) & 0xffffffn) || 0x800000;
}

type Row = Pick<GlobalRow, "name" | "row">;
type TableName = keyof typeof tables;

const custom = (name: string, attributes: string[], getter: string, setter = "nullptr"): Row => ({
  name,
  row: `{ "${name}"_s, static_cast<unsigned>(${attributes.map(it => `PropertyAttribute::${it}`).join(" | ")}), NoIntrinsic, { HashTableValue::GetterSetterType, ${getter}, ${setter} } }`,
});

const tableOfBun = readFileSync(join(import.meta.dirname, "../jsc/bindings/ZigGlobalObject.lut.txt"), "utf8");
const ofBun = [...tableOfBun.matchAll(/^ +(\w+) +\S+ +\S+/gm)].map(match => match[1]);
const same = words(sameObject);

function rowsOf(table: Table): Row[] {
  const value = (names: string | undefined, getter: string, ...attributes: string[]) =>
    words(names).map(name => custom(name, ["CustomValue", ...attributes], getter));
  return [
    ...words(table.declared).map(name => ({ name, row: "" })),
    ...value(table.values, "loadMember"),
    ...value(table.inherited, "loadInherited"),
    ...value(table.nativeOperations, "loadNative"),
    ...value(table.hiddenValues, "loadMember", "DontEnum"),
    ...value(table.native, "loadNative", "DontEnum"),
    ...value(table.prefixedNative, "loadPrefixedNative", "DontEnum"),
    ...value(table.emptyObjects, "loadEmptyObject", "DontEnum"),
    ...value(table.interfaces, "loadInterface", "DontEnum"),
  ];
}

function tablesExposing({ name, exposed, secure }: GlobalRow): TableName[] {
  const has = (name: string) => exposed.includes(name) || (name !== "Window" && exposed.includes("Worker"));
  const [window, dedicated, shared, service] = ["Window", "DedicatedWorker", "SharedWorker", "ServiceWorker"].map(has);
  if (secure && window && dedicated && shared && service) return ["secure"];
  if (secure && shared) throw new Error("There is no table for secure shared workers alone");
  const ofWorkers: TableName[] =
    dedicated && shared
      ? [service ? "worker" : "ownedWorker"]
      : dedicated
        ? [secure ? "secureDedicatedWorker" : "dedicatedWorker"]
        : shared
          ? ["sharedWorker"]
          : [];
  if (service && !(dedicated && shared)) ofWorkers.push("serviceWorker");
  const ofWindows = secure
    ? "secureWindow"
    : ofBun.includes(name) && !words(replacesBun).includes(name)
      ? "window"
      : "document";
  return window ? [ofWindows, ...ofWorkers] : ofWorkers;
}

/** What a schema declares takes the place of what web-globals.ts lists under its name. */
function allRows(ofSchemas: readonly GlobalRow[]): [string, Row[]][] {
  // Deleting any of the names would run every `PropertyCallback`.
  const declared = ofSchemas.map(it =>
    it.memberOf ? it : { ...it, ...custom(it.name, ["CustomValue", "DontEnum"], "loadInterface") },
  );
  const listed = Object.entries<Table>(tables).map(([id, table]): [string, Row[]] => [id, rowsOf(table)]);
  const isOfWindow = (id: string) => !/worker/i.test(id);
  const takesPlaceOf = (it: GlobalRow, row: Row, id: string) =>
    it.name === row.name && (!it.memberOf || it.exposed.includes("Window") === isOfWindow(id));
  const isListed = (it: GlobalRow) => listed.some(([id, rows]) => rows.some(row => takesPlaceOf(it, row, id)));
  return listed.map(([id, rows]) => [
    id,
    [
      ...rows.map(row => declared.find(it => takesPlaceOf(it, row, id)) ?? row),
      ...declared.filter(it => !isListed(it) && tablesExposing(it).includes(id as TableName)),
    ],
  ]);
}

const remembering = ({ name, row }: Row) =>
  same.includes(name) && row.includes("::CustomAccessor")
    ? row.replace(/GetterSetterType, ([\w:]+)/, `GetterSetterType, getSameObject<${same.indexOf(name)}, $1>`)
    : row;

function emit(id: string, rows: Row[]): string {
  const size = 2 ** Math.ceil(Math.log2(2 * rows.length));
  const index = Array.from({ length: size }, () => [-1, -1]);
  rows.forEach(({ name }, row) => {
    if (!rows[row].row) throw new Error(`No schema declares ${name}`);
    if (rows.findIndex(other => other.name === name) !== row) throw new Error(`${name} is twice in ${id}`);
    let at = hashOf(name) % size;
    while (index[at][0] !== -1) {
      if (index[at][1] === -1) index[at][1] = index.push([-1, -1]) - 1;
      at = index[at][1];
    }
    index[at][0] = row;
  });
  const ofStructures = /PropertyAttribute::(?:ReadOnly|DontEnum|DontDelete|Custom\w+)\b/g;
  const seen = new Set(rows.flatMap(({ row }) => row.match(ofStructures) ?? []));
  return `static constinit const CompactHashIndex ${id}Index[] = { ${index.map(it => `{ ${it} }`).join(", ")} };
static constinit const HashTableValue ${id}Values[] = {
${rows.map(row => `    ${remembering(row)},`).join("\n")}
};
static constinit const HashTable ${id} = { ${rows.length}, ${size - 1}, ${[0, ...seen].map(it => `static_cast<uint8_t>(${it})`).join(" | ")}, nullptr, ${id}Values, ${id}Index };
`;
}

export function writeWebGlobals(directory: string, declared: readonly GlobalRow[]) {
  const literals = (names: string[]) => names.map(name => `"${name}"_s`).join(", ");
  writeIfNotChanged(
    join(directory, "WebGlobalObject.names.h"),
    `#pragma once
${[...new Set(declared.filter(it => it.memberOf).map(it => it.declarations))].join("\n")}
namespace Bun::WebGlobals {
static constexpr ASCIILiteral sameObjectNames[] = { ${literals(same)} };
}
`,
  );
  writeIfNotChanged(
    join(directory, "WebGlobalObject.lut.h"),
    "#pragma once\n" +
      allRows(declared)
        .map(([id, rows]) => emit(`${id}Table`, rows))
        .join("\n"),
  );

  const shared = [...words(tables.everywhere.native), ...words(tables.everywhere.nativeOperations)].filter(
    name => !declared.some(it => it.name === name),
  );
  const different = ofBun.filter(it => !shared.includes(it));
  const list = (names: string[]) => names.map(name => `"${name}"`).join(", ");
  writeIfNotChanged(
    join(directory, "web_globals.rs"),
    `const ABSENT_OR_DIFFERENT: &[&str] = &[${list([...different, "Blob", "File", "SharedArrayBuffer", "console", "self"])}];
const DEPENDS_ON_REALM: &[&str] = &[${list(words(dependsOnRealm))}];
const KEPT_ASIDE: &[&str] = &[${list(words(keptAside))}];
`,
  );
}
