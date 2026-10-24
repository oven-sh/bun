type MapValue = number | string | object | null | undefined;
type TableKey = string | number;

const maxSteps = 600;
const sizes = [3, 4, 8, 9, 64, 254];
const sharedValue = { label: "shared" };

function valueText(value: MapValue): string {
  return value === sharedValue ? "shared" : String(value);
}

function createMap(count: number): Map<TableKey, MapValue> {
  const map = new Map<TableKey, MapValue>();
  for (let index = 0; index < count; index++) map.set("key-" + index, index);
  return map;
}

function createSet(count: number): Set<TableKey> {
  const set = new Set<TableKey>();
  for (let index = 0; index < count; index++) set.add("key-" + index);
  return set;
}

function summary(parts: string[]): string {
  if (parts.length <= 16) return parts.join(" ");
  return `${parts.slice(0, 8).join(" ")} .. ${parts.slice(-6).join(" ")} (${parts.length})`;
}

function iterateMap(name: string, count: number, body: (map: Map<TableKey, MapValue>, step: number, count: number) => void): void {
  const map = createMap(count);
  const seen: string[] = [];
  for (const [key, value] of map) {
    seen.push(key + "=" + valueText(value));
    if (seen.length >= maxSteps) break;
    body(map, seen.length - 1, count);
  }
  const after: string[] = [];
  for (const [key, value] of map) after.push(key + "=" + valueText(value));
  console.log("map", name, count, "saw", summary(seen));
  console.log("map", name, count, "then", map.size, summary(after));
}

function iterateSet(name: string, count: number, body: (set: Set<TableKey>, step: number, count: number) => void): void {
  const set = createSet(count);
  const seen: string[] = [];
  for (const key of set) {
    seen.push(String(key));
    if (seen.length >= maxSteps) break;
    body(set, seen.length - 1, count);
  }
  console.log("set", name, count, "saw", summary(seen));
  console.log("set", name, count, "then", set.size, summary([...set].map(String)));
}

function nestedMapIteration(count: number): void {
  const map = createMap(count);
  const seen: string[] = [];
  for (const [outer] of map) {
    for (const [inner] of map) {
      seen.push(outer + "/" + inner);
      if (seen.length === 5) map.delete("key-1");
      if (seen.length === 7) map.set("added-inner", 1.5);
      if (seen.length >= 40) break;
    }
    if (seen.length >= 40) break;
    if (seen.length === 2 * map.size) map.set("added-outer", sharedValue);
  }
  console.log("nested map", count, map.size, summary(seen));
}

function nestedSetIteration(count: number): void {
  const set = createSet(count);
  const seen: string[] = [];
  for (const outer of set) {
    for (const inner of set) {
      seen.push(outer + "/" + inner);
      if (seen.length === 3) set.add("added-inner");
      if (seen.length === 6) set.delete("key-0");
      if (seen.length >= 40) break;
    }
    if (seen.length >= 40) break;
  }
  console.log("nested set", count, set.size, summary(seen));
}

function twoIteratorsOverClearedMap(count: number): void {
  const map = createMap(count);
  const first = map.keys();
  const second = map.entries();
  const seen = [first.next().value, second.next().value];
  map.clear();
  map.set("after-clear", 1);
  seen.push(first.next().value, second.next().value);
  console.log("two iterators", count, JSON.stringify(seen), first.next().done, second.next().done);
}

for (const count of sizes) {
  iterateMap("unchanged", count, () => {});
  iterateSet("unchanged", count, () => {});
  iterateMap("adds", count, (map, step) => {
    if (step < 300) map.set("added-" + step, step);
  });
  iterateSet("adds", count, (set, step) => {
    if (step < 300) set.add("added-" + step);
  });
  iterateMap("deletes the next key", count, (map, step) => {
    map.delete("key-" + (step + 1));
  });
  iterateSet("deletes the next key", count, (set, step) => {
    set.delete("key-" + (step + 1));
  });
  iterateMap("deletes the current key", count, (map, step) => {
    map.delete("key-" + step);
  });
  iterateSet("deletes earlier keys, then grows", count, (set, step) => {
    if (step % 3 === 2) set.delete("key-" + (step - 2));
    if (step < 20) set.add("grown-" + step);
  });
  iterateMap("deletes earlier keys, then grows", count, (map, step) => {
    if (step % 3 === 2) map.delete("key-" + (step - 2));
    if (step < 20) map.set("grown-" + step, step);
  });
  iterateMap("clears", count, (map, step) => {
    if (step !== 1) return;
    map.clear();
    map.set("after-clear", 1);
  });
  iterateSet("clears", count, (set, step) => {
    if (step !== 1) return;
    set.clear();
    set.add("after-clear");
  });
  iterateMap("stores a double", count, (map, step, size) => {
    if (step === 1) map.set("key-" + (size - 1), 1.5);
  });
  iterateMap("stores a double, then an object", count, (map, step, size) => {
    if (step === 0) map.set("key-" + (size - 1), 1.5);
    if (step === 1) map.set("key-" + (size - 2), sharedValue);
    if (step === 2) map.set("new-wide", 2.5);
  });
  iterateMap("deletes, then stores a double", count, (map, step, size) => {
    if (step === 1) map.delete("key-0");
    if (step === 1) map.set("key-" + (size - 1), 1.5);
  });
  iterateMap("stores a number key", count, (map, step) => {
    if (step === 1) map.set(step, "number key");
  });
  iterateSet("stores a number key", count, (set, step) => {
    if (step === 1) set.add(step);
  });
  nestedMapIteration(count);
  nestedSetIteration(count);
  twoIteratorsOverClearedMap(count);
}
