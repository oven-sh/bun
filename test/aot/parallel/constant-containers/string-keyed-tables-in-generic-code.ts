type RuntimeFunction = (...args: any[]) => any;
type AnyMap = Map<unknown, unknown>;
type AnySet = Set<unknown>;

interface Operation {
  name: string;
  run: RuntimeFunction;
}

interface TableKind {
  name: string;
  counts: number[];
  otherKey: unknown;
  key: (index: number) => unknown;
  createMap: (count: number) => AnyMap;
  createSet: (count: number) => AnySet;
  setInMap: (map: AnyMap, index: number) => void;
  addToSet: (set: AnySet, index: number) => void;
  deleteFromMap: (map: AnyMap, index: number) => boolean;
  deleteFromSet: (set: AnySet, index: number) => boolean;
  readMap: (map: AnyMap, index: number) => unknown[];
  readSet: (set: AnySet, index: number) => boolean;
}

const sharedObject = { label: "shared" };

function checksum(parts: string[]): number {
  let sum = 0;
  for (const part of parts) {
    for (let i = 0; i < part.length; i++) sum = (Math.imul(sum, 31) + part.charCodeAt(i)) | 0;
  }
  return sum;
}

function abbreviate(parts: string[]): string {
  if (parts.length <= 12) return parts.join(", ");
  return `${parts.slice(0, 3).join(", ")}, .. ${parts.length} in all, checksum ${checksum(parts)} .., ${parts.slice(-3).join(", ")}`;
}

function listMap(map: AnyMap): string {
  const entries: string[] = [];
  for (const [key, value] of map) entries.push(text(key) + " => " + text(value));
  return `Map(${map.size}) {${abbreviate(entries)}}`;
}

function listSet(set: AnySet): string {
  const keys: string[] = [];
  for (const key of set) keys.push(text(key));
  return `Set(${set.size}) {${abbreviate(keys)}}`;
}

function text(value: unknown): string {
  if (value === sharedObject) return "sharedObject";
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + abbreviate(value.map(text)) + "]";
  if (value instanceof Map) return listMap(value);
  if (value instanceof Set) return listSet(value);
  return String(value);
}

function attempt(run: () => unknown): string {
  try {
    return text(run());
  } catch (error) {
    return "throws " + String(error);
  }
}

const stringKeys: TableKind = {
  name: "string keys",
  counts: [0, 3, 9, 300],
  otherKey: 1,
  key: (index: number): unknown => "k" + index,
  createMap: (count: number): AnyMap => {
    const map = new Map<unknown, unknown>();
    for (let i = 0; i < count; i++) map.set("k" + i, i);
    return map;
  },
  createSet: (count: number): AnySet => {
    const set = new Set<unknown>();
    for (let i = 0; i < count; i++) set.add("k" + i);
    return set;
  },
  setInMap: (map: AnyMap, index: number): void => {
    map.set("k" + index, index);
  },
  addToSet: (set: AnySet, index: number): void => {
    set.add("k" + index);
  },
  deleteFromMap: (map: AnyMap, index: number): boolean => map.delete("k" + index),
  deleteFromSet: (set: AnySet, index: number): boolean => set.delete("k" + index),
  readMap: (map: AnyMap, index: number): unknown[] => [map.has("k" + index), map.get("k" + index)],
  readSet: (set: AnySet, index: number): boolean => set.has("k" + index),
};

const constantStringKeys: TableKind = {
  ...stringKeys,
  name: "constant string keys",
  counts: [3, 9],
  createMap: (count: number): AnyMap => {
    if (count === 3) return new Map<unknown, unknown>([["k0", 0], ["k1", 1], ["k2", 2]]);
    return new Map<unknown, unknown>([["k0", 0], ["k1", 1], ["k2", 2], ["k3", 3], ["k4", 4], ["k5", 5], ["k6", 6], ["k7", 7], ["k8", 8]]);
  },
  createSet: (count: number): AnySet => {
    if (count === 3) return new Set<unknown>(["k0", "k1", "k2"]);
    return new Set<unknown>(["k0", "k1", "k2", "k3", "k4", "k5", "k6", "k7", "k8"]);
  },
};

const numberKeys: TableKind = {
  name: "number keys",
  counts: [0, 3, 9, 300],
  otherKey: "k1",
  key: (index: number): unknown => index,
  createMap: (count: number): AnyMap => {
    const map = new Map<unknown, unknown>();
    for (let i = 0; i < count; i++) map.set(i, i);
    return map;
  },
  createSet: (count: number): AnySet => {
    const set = new Set<unknown>();
    for (let i = 0; i < count; i++) set.add(i);
    return set;
  },
  setInMap: (map: AnyMap, index: number): void => {
    map.set(index, index);
  },
  addToSet: (set: AnySet, index: number): void => {
    set.add(index);
  },
  deleteFromMap: (map: AnyMap, index: number): boolean => map.delete(index),
  deleteFromSet: (set: AnySet, index: number): boolean => set.delete(index),
  readMap: (map: AnyMap, index: number): unknown[] => [map.has(index), map.get(index)],
  readSet: (set: AnySet, index: number): boolean => set.has(index),
};

const parameters = "table, first, last, absent, other, object, closure, plainFunction, throwingFunction";

function operation(name: string, body: string): Operation {
  return { name, run: new Function(parameters, body) as RuntimeFunction };
}

const commonOperations: Operation[] = [
  operation("has", "return [table.has(first), table.has(last), table.has(absent), table.has(other), table.has(object)];"),
  operation("rope and substring keys", "return [table.has('k' + (table.size - 1)), table.has('xxk0xx'.slice(2, 4)), table.delete('k' + 0), table.size];"),
  operation("delete", "return [table.delete(first), table.delete(first), table.delete(absent), table.delete(other), table.delete(object), table.size];"),
  operation("clear", "table.clear(); return [table.has(first), table.size];"),
  operation("size", "return table.size;"),
  operation("spread", "return [...table];"),
  operation("keys, values, entries", "return [[...table.keys()], [...table.values()], [...table.entries()]];"),
];

const mapOperations: Operation[] = [
  ...commonOperations,
  operation("get", "return [table.get(first), table.get(last), table.get(absent), table.get(other), table.get(object)];"),
  operation("set present key", "return [table.set(first, 'replaced') === table, table.get(first), table.size];"),
  operation("set absent key", "return [table.set(absent, 'added') === table, table.get(absent), table.size];"),
  operation("set key of another kind", "table.set(other, 'other'); return [table.get(other), table.get(first), table.size];"),
  operation("set object key", "table.set(object, 'object'); return [table.get(object), table.get(first), table.size];"),
  operation("set double and object values", "table.set(first, 0.5); table.set(absent, object); return [table.get(first), table.get(absent), table.size];"),
  operation("set empty and 16-bit keys", "table.set('', 'empty'); table.set('日本', 'wide'); return [table.get(''), table.get('日本'), table.has('日'), table.size];"),
  operation("set 40 string keys", "for (var i = 0; i < 40; i++) table.set('grown' + i, i); return [table.get('grown39'), table.size];"),
  operation("clear, then set", "table.clear(); table.set(last, 'again'); return [table.get(last), table.size];"),
  operation("copy", "var copy = new Map(table); copy.set(absent, 'copy only'); table.delete(first); return [copy, copy.has(first), table.has(absent)];"),
  operation("forEach", "var seen = []; table.forEach(function (value, key, map) { seen.push([key, value, map === table]); }); return seen;"),
  operation("forEach that changes the table", "var seen = []; table.forEach(function (value, key) { seen.push(key); if (seen.length === 1) { table.delete(last); table.set(absent, 'added'); } }); return seen;"),
  operation("Array.from", "return [Array.from(table), Array.from(table, function (entry) { return entry[0]; })];"),
  operation("getOrInsert", "return [table.getOrInsert(first, 'inserted'), table.getOrInsert(absent, 'inserted'), table.getOrInsert(other, 'inserted'), table.size];"),
  operation("getOrInsertComputed, compiled closure", "return [table.getOrInsertComputed(first, closure), table.getOrInsertComputed(absent, closure), table.getOrInsertComputed(other, closure), table.size];"),
  operation("getOrInsertComputed, compiled function", "return [table.getOrInsertComputed(first, plainFunction), table.getOrInsertComputed(absent, plainFunction), table.getOrInsertComputed(other, plainFunction), table.size];"),
  operation("getOrInsertComputed, compiled function that throws", "return table.getOrInsertComputed(absent, throwingFunction);"),
  operation("getOrInsertComputed, run-time function", "function compute(key) { return 'computed at run time for ' + String(key); } return [table.getOrInsertComputed(first, compute), table.getOrInsertComputed(absent, compute), table.getOrInsertComputed(other, compute), table.size];"),
  operation("structuredClone", "return structuredClone(table);"),
  operation("Bun.deepEquals", "return [Bun.deepEquals(table, new Map(table)), Bun.deepEquals(new Map(table), table)];"),
];

const setOperations: Operation[] = [
  ...commonOperations,
  operation("add present key", "return [table.add(first) === table, table.size];"),
  operation("add absent key", "return [table.add(absent) === table, table.has(absent), table.size];"),
  operation("add key of another kind", "table.add(other); return [table.has(other), table.has(first), table.size];"),
  operation("add object key", "table.add(object); return [table.has(object), table.has(first), table.size];"),
  operation("add empty and 16-bit keys", "table.add(''); table.add('日本'); return [table.has(''), table.has('日本'), table.has('日'), table.size];"),
  operation("add 40 string keys", "for (var i = 0; i < 40; i++) table.add('grown' + i); return [table.has('grown39'), table.size];"),
  operation("clear, then add", "table.clear(); table.add(last); return [table.has(last), table.size];"),
  operation("copy", "var copy = new Set(table); copy.add(absent); table.delete(first); return [copy, copy.has(first), table.has(absent)];"),
  operation("forEach", "var seen = []; table.forEach(function (value, key, set) { seen.push([key, value, set === table]); }); return seen;"),
  operation("forEach that changes the table", "var seen = []; table.forEach(function (key) { seen.push(key); if (seen.length === 1) { table.delete(last); table.add(absent); } }); return seen;"),
  operation("Array.from", "return [Array.from(table), Array.from(table, function (key) { return [key]; })];"),
  operation("union", "return [table.union(new Set([first, absent, other])), new Set([absent, first]).union(table)];"),
  operation("isSubsetOf", "return [table.isSubsetOf(new Set(table)), table.isSubsetOf(new Set([first])), new Set([first]).isSubsetOf(table), new Set([absent]).isSubsetOf(table)];"),
  operation("structuredClone", "return structuredClone(table);"),
  operation("Bun.deepEquals", "return [Bun.deepEquals(table, new Set(table)), Bun.deepEquals(new Set(table), table)];"),
];

const createKeyIterator = new Function("table", "return table.keys();") as RuntimeFunction;
const stepIterator = new Function("iterator", "var result = iterator.next(); return result.done ? [] : [result.value];") as RuntimeFunction;
const countBySpreading = new Function("table", "return [...table].length;") as RuntimeFunction;

function computeValue(key: unknown): unknown {
  return "computed for " + text(key);
}

function throwForKey(key: unknown): unknown {
  throw new Error("no value for " + text(key));
}

function readUntyped(table: any, present: unknown, absent: unknown): string {
  return text([table.size, table.has(present), table.has(absent)]);
}

function describeMap(kind: TableKind, map: AnyMap, count: number): string {
  const reads = [0, count - 1, -1, 500].map((index: number): unknown[] => kind.readMap(map, index));
  return `${text(reads)} ${readUntyped(map, kind.key(0), kind.key(-1))} ${listMap(map)}`;
}

function describeSet(kind: TableKind, set: AnySet, count: number): string {
  const reads = [0, count - 1, -1, 500].map((index: number): boolean => kind.readSet(set, index));
  return `${text(reads)} ${readUntyped(set, kind.key(0), kind.key(-1))} ${listSet(set)}`;
}

function stepKeys(table: unknown, count: number, add: (index: number) => void, remove: (index: number) => void): string {
  const iterator: unknown = createKeyIterator(table);
  add(600);
  const seen: unknown[] = [];
  for (let turn = 0; turn < count + 10; turn++) {
    const stepped: unknown[] = stepIterator(iterator);
    if (stepped.length === 0) break;
    seen.push(stepped[0]);
    if (turn === 0) {
      add(601);
      remove(1);
    } else if (turn === 1) {
      remove(601);
      add(602);
    } else if (turn === 2) {
      remove(0);
    }
  }
  return text(seen);
}

function walkMap(kind: TableKind, map: AnyMap): string {
  const seen: unknown[] = [];
  for (const [key, value] of map) {
    seen.push([key, value]);
    if (seen.length === 2) seen.push(countBySpreading(map));
    if (seen.length === 5) kind.setInMap(map, 700);
  }
  return text(seen);
}

function walkSet(kind: TableKind, set: AnySet): string {
  const seen: unknown[] = [];
  for (const key of set) {
    seen.push(key);
    if (seen.length === 2) seen.push(countBySpreading(set));
    if (seen.length === 5) kind.addToSet(set, 700);
  }
  return text(seen);
}

function runMapOperations(kind: TableKind, count: number): void {
  const title = `${kind.name}, Map of ${count}, `;
  for (const { name, run } of mapOperations) {
    const map = kind.createMap(count);
    const closure = (key: unknown): unknown => {
      kind.setInMap(map, 500);
      return computeValue(key);
    };
    const result = attempt(() => run(map, kind.key(0), kind.key(count - 1), kind.key(-1), kind.otherKey, sharedObject, closure, computeValue, throwForKey));
    console.log(`${title}${name}: ${result} | ${describeMap(kind, map, count)}`);
  }

  const stepped = kind.createMap(count);
  const add = (index: number): void => kind.setInMap(stepped, index);
  const remove = (index: number): void => {
    kind.deleteFromMap(stepped, index);
  };
  console.log(`${title}keys() stepped while compiled code changes the table: ${stepKeys(stepped, count, add, remove)} | ${describeMap(kind, stepped, count)}`);

  const walked = kind.createMap(count);
  console.log(`${title}compiled walk while run-time code spreads the table: ${walkMap(kind, walked)} | ${describeMap(kind, walked, count)}`);
}

function runSetOperations(kind: TableKind, count: number): void {
  const title = `${kind.name}, Set of ${count}, `;
  for (const { name, run } of setOperations) {
    const set = kind.createSet(count);
    const result = attempt(() => run(set, kind.key(0), kind.key(count - 1), kind.key(-1), kind.otherKey, sharedObject));
    console.log(`${title}${name}: ${result} | ${describeSet(kind, set, count)}`);
  }

  const stepped = kind.createSet(count);
  const add = (index: number): void => kind.addToSet(stepped, index);
  const remove = (index: number): void => {
    kind.deleteFromSet(stepped, index);
  };
  console.log(`${title}keys() stepped while compiled code changes the table: ${stepKeys(stepped, count, add, remove)} | ${describeSet(kind, stepped, count)}`);

  const walked = kind.createSet(count);
  console.log(`${title}compiled walk while run-time code spreads the table: ${walkSet(kind, walked)} | ${describeSet(kind, walked, count)}`);
}

function runRenamedBuiltins(): void {
  const map: any = stringKeys.createMap(3);
  map.has = Map.prototype.get;
  map.get = Map.prototype.has;
  map.add = Map.prototype.set;
  console.log("Map methods under other names: " + attempt(() => [map.has("k1"), map.get("k1"), map.add("k9", 9) === map, map.size]));

  const set: any = stringKeys.createSet(3);
  set.has = Set.prototype.add;
  set.add = Set.prototype.has;
  console.log("Set methods under other names: " + attempt(() => [set.add("k1"), set.has("k9") === set, set.size]));

  const holder: any = { get: Map.prototype.get, has: Set.prototype.has, set: Map.prototype.set, add: Set.prototype.add };
  console.log("receivers that are not tables: " + [attempt(() => holder.get("k1")), attempt(() => holder.has("k1")), attempt(() => holder.set("k1", 1)), attempt(() => holder.add("k1"))].join("; "));
  console.log("receivers of the other class: " + [attempt(() => Map.prototype.get.call(set, "k1")), attempt(() => Set.prototype.has.call(map, "k1"))].join("; "));
}

for (const kind of [stringKeys, constantStringKeys, numberKeys]) {
  for (const count of kind.counts) {
    runMapOperations(kind, count);
    runSetOperations(kind, count);
  }
}
runRenamedBuiltins();

export {};
