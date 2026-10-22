// An iterator of a Map or a Set follows every change to its table: it visits an entry added after it started, skips an entry deleted before it got there, continues after the table grew, shrank, was cleared or took a key or value of another kind, and stays finished once it has finished. The same holds for `forEach`, `for-of`, spread and `Array.from` over an iterator that has started.
const objects = Array.from({ length: 2000 }, (_, index) => ({ id: index }));

function show(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (Array.isArray(value)) return "[" + value.map(show).join("=") + "]";
  if (typeof value === "object" && value !== null) return "#" + (value as { id: number }).id;
  return String(value);
}
function shorten(parts: string[]): string {
  if (parts.length <= 14) return parts.join(" ");
  let sum = 0;
  for (const part of parts) for (let i = 0; i < part.length; i++) sum = (Math.imul(sum, 31) + part.charCodeAt(i)) | 0;
  return parts.slice(0, 4).join(" ") + " ..(" + parts.length + " in all, checksum " + sum + ").. " + parts.slice(-4).join(" ");
}

type Table = Map<unknown, unknown> | Set<unknown>;
type KeyAt = (index: number) => unknown;
const put = (table: Table, key: unknown, value: unknown): void => void (table instanceof Map ? table.set(key, value) : table.add(key));
function create(isMap: boolean, count: number, keyAt: KeyAt): Table {
  const table: Table = isMap ? new Map() : new Set();
  for (let index = 0; index < count; index++) put(table, keyAt(index), keyAt(index));
  return table;
}

const limit = 1200;
type Change = (table: Table, step: number, count: number, keyAt: KeyAt) => void;
const changes: [string, Change][] = [
  ["nothing", () => {}],
  ["deletes the current entry", (table, step, _count, keyAt) => void table.delete(keyAt(step))],
  ["deletes the next entry", (table, step, _count, keyAt) => void (step % 2 === 0 && table.delete(keyAt(step + 1)))],
  ["deletes every earlier entry", (table, step, _count, keyAt) => { if (step === 3) for (let index = 0; index < 3; index++) table.delete(keyAt(index)); }],
  ["deletes every later entry", (table, step, count, keyAt) => { if (step === 1) for (let index = 2; index < count; index++) table.delete(keyAt(index)); }],
  ["deletes and adds the current entry", (table, step, count, keyAt) => { if (step < count) { table.delete(keyAt(step)); put(table, keyAt(step), "again"); } }],
  ["adds one entry each step", (table, step, count, keyAt) => { if (step < count + 5) put(table, keyAt(1000 + step), step); }],
  ["adds 300 entries at once", (table, step, _count, keyAt) => { if (step === 0) for (let index = 0; index < 300; index++) put(table, keyAt(1000 + index), index); }],
  ["adds 300 entries and deletes them", (table, step, _count, keyAt) => { if (step === 0) { for (let index = 0; index < 300; index++) put(table, keyAt(1000 + index), index); for (let index = 0; index < 300; index++) table.delete(keyAt(1000 + index)); } }],
  ["adds keys and values of other kinds", (table, step) => { if (step === 0) for (const key of ["text", 7, 0.5, objects[1999], undefined, null, true, 5n, NaN]) put(table, key, key); }],
  ["clears", (table, step) => { if (step === 1) table.clear(); }],
  ["clears and fills again", (table, step, count, keyAt) => { if (step === 1) { table.clear(); for (let index = 0; index < count; index++) put(table, keyAt(index), "refilled"); } }],
  ["clears and adds one entry", (table, step, _count, keyAt) => { if (step === 1) { table.clear(); put(table, keyAt(1500), "after clear"); } }],
  ["clears twice", (table, step, _count, keyAt) => { if (step === 0 || step === 1) { table.clear(); put(table, keyAt(1500 + step), "after clear"); } }],
];

type Walk = (table: Table, change: (step: number) => void) => string[];
const walks: [string, Walk][] = [
  ["next()", (table, change) => {
    const seen: string[] = [];
    const iterator = table.entries();
    for (let result = iterator.next(); !result.done && seen.length < limit; result = iterator.next()) {
      seen.push(show(result.value));
      change(seen.length - 1);
    }
    return seen;
  }],
  ["keys().next()", (table, change) => {
    const seen: string[] = [];
    const iterator = table.keys();
    for (let result = iterator.next(); !result.done && seen.length < limit; result = iterator.next()) {
      seen.push(show(result.value));
      change(seen.length - 1);
    }
    return seen;
  }],
  ["for-of", (table, change) => {
    const seen: string[] = [];
    for (const entry of table) {
      seen.push(show(entry));
      if (seen.length === limit) break;
      change(seen.length - 1);
    }
    return seen;
  }],
  ["for-of over values()", (table, change) => {
    const seen: string[] = [];
    for (const value of table.values()) {
      seen.push(show(value));
      if (seen.length === limit) break;
      change(seen.length - 1);
    }
    return seen;
  }],
  ["forEach", (table, change) => {
    const seen: string[] = [];
    table.forEach((value: unknown, key: unknown) => {
      seen.push(show([key, value]));
      if (seen.length < limit) change(seen.length - 1);
    });
    return seen;
  }],
  ["one step, the change, then spread", (table, change) => {
    const iterator = table.keys();
    const first = iterator.next();
    change(0);
    change(1);
    return [first.done ? "done" : show(first.value), "|", ...[...iterator].map(show)];
  }],
  ["one step, the change, then Array.from", (table, change) => {
    const iterator = table.values();
    const first = iterator.next();
    change(0);
    change(1);
    return [first.done ? "done" : show(first.value), "|", ...Array.from(iterator, show)];
  }],
];

const kinds: [string, KeyAt][] = [
  ["strings", index => "k" + index],
  ["integers", index => index],
  ["objects", index => objects[index]],
];
for (const isMap of [true, false]) {
  for (const [kind, keyAt] of kinds) {
    for (const count of kind === "strings" ? [1, 4, 5, 8, 9, 254, 255] : [5, 9]) {
      for (const [changeName, change] of changes) {
        const results = walks.map(([walkName, walk]): [string, string] => {
          const table = create(isMap, count, keyAt);
          const seen = walk(table, step => change(table, step, count, keyAt));
          return [walkName, shorten(seen) + " -> " + table.size];
        });
        console.log((isMap ? "map" : "set") + " of " + count + " " + kind + ", " + changeName);
        for (const [walkName, result] of results) console.log("  " + walkName + ": " + result);
      }
    }
  }
}

function finishedIteratorsStayFinished(table: Table): string {
  const iterators = [table.keys(), table.values(), table.entries(), table[Symbol.iterator]()];
  const before = iterators.map(iterator => [...iterator].length);
  put(table, "late", "late");
  const after = iterators.map(iterator => String(iterator.next().done));
  return before.join() + " " + after.join() + " " + [...table.keys()].length;
}
console.log("finished iterators:", finishedIteratorsStayFinished(new Map([["a", 1]])), finishedIteratorsStayFinished(new Set(["a"])), finishedIteratorsStayFinished(new Map()), finishedIteratorsStayFinished(new Set()));

function iteratorsOfEmptyTables(table: Table, keyAt: KeyAt): string {
  const iterators = [table.keys(), table.values(), table.entries(), table[Symbol.iterator]()];
  for (let index = 0; index < 10; index++) put(table, keyAt(index), index);
  table.delete(keyAt(0));
  return iterators.map(iterator => shorten([...iterator].map(show))).join(" | ");
}
for (const [kind, keyAt] of kinds) console.log("iterators created while the table is empty, " + kind + ":", iteratorsOfEmptyTables(new Map(), keyAt), "/", iteratorsOfEmptyTables(new Set(), keyAt));

function severalIterators(table: Table, keyAt: KeyAt): string {
  const slow = table.keys();
  const fast = table.keys();
  const seen: string[] = [];
  for (let step = 0; step < 6; step++) {
    seen.push("fast " + show(fast.next().value), "fast " + show(fast.next().value), "slow " + show(slow.next().value));
    table.delete(keyAt(step * 2));
    put(table, keyAt(100 + step), step);
    if (step === 3) for (let index = 0; index < 40; index++) put(table, keyAt(200 + index), index);
  }
  return seen.join(", ") + " | " + [...slow].length + " " + [...fast].length + " " + table.size;
}
for (const [kind, keyAt] of kinds) console.log("two iterators, " + kind + ":", severalIterators(create(true, 12, keyAt), keyAt), "/", severalIterators(create(false, 12, keyAt), keyAt));

function nestedLoops(table: Table, keyAt: KeyAt): string {
  const seen: string[] = [];
  for (const outer of table.keys()) {
    for (const inner of table.keys()) {
      seen.push(show(outer) + show(inner));
      if (seen.length === 3) table.delete(keyAt(1));
      if (seen.length === 5) put(table, keyAt(50), 50);
      if (seen.length > 60) return "too many";
    }
  }
  return seen.join(" ");
}
for (const [kind, keyAt] of kinds) console.log("nested loops, " + kind + ":", nestedLoops(create(true, 4, keyAt), keyAt), "/", nestedLoops(create(false, 4, keyAt), keyAt));

function iteratorOutlivesTable(): string {
  let table: Table | null = create(true, 20, index => "k" + index);
  const iterator = table.entries();
  iterator.next();
  table.clear();
  table = null;
  const filler: unknown[] = [];
  for (let index = 0; index < 20000; index++) filler.push({ id: index }, "s" + index);
  return String(iterator.next().done) + " " + filler.length;
}
console.log("an iterator whose table is cleared and dropped:", iteratorOutlivesTable());
