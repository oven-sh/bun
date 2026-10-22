type TableKey = string | number | KeyObject;

interface KeyObject {
  id: number;
}

const checkpoints = [1, 4, 8, 9, 63, 64, 254, 255, 5000];
const keyObjects: KeyObject[] = [];

function keyObject(index: number): KeyObject {
  keyObjects[index] ??= { id: index };
  return keyObjects[index];
}

function stringKey(index: number): string {
  return "key-" + index;
}

function mixedKey(index: number): TableKey {
  if (index % 5 === 1) return index;
  if (index % 5 === 3) return keyObject(index);
  return stringKey(index);
}

function keyText(key: TableKey): string {
  return typeof key === "object" ? "object-" + key.id : typeof key + "-" + key;
}

function checksum(parts: string[]): number {
  let sum = 0;
  for (const part of parts) {
    for (let i = 0; i < part.length; i++) sum = (Math.imul(sum, 31) + part.charCodeAt(i)) | 0;
  }
  return sum;
}

function summary(parts: string[]): string {
  return `${parts.length} [${parts.slice(0, 3).join(", ")} .. ${parts.slice(-2).join(", ")}] ${checksum(parts)}`;
}

function listMap(map: Map<TableKey, number>): string {
  const parts: string[] = [];
  for (const [key, value] of map) parts.push(keyText(key) + "=" + value);
  return summary(parts);
}

function listSet(set: Set<TableKey>): string {
  const parts: string[] = [];
  for (const key of set) parts.push(keyText(key));
  return summary(parts);
}

function growMap(name: string, keyOf: (index: number) => TableKey): void {
  const map = new Map<TableKey, number>();
  for (let index = 0; index < 5000; index++) {
    map.set(keyOf(index), index * 2);
    if (!checkpoints.includes(index + 1)) continue;
    const tenth: (number | undefined)[] = [];
    for (let read = 0; read <= index; read += 10) tenth.push(map.get(keyOf(read)));
    const absent = [map.has(keyOf(index + 1)), map.has("absent"), map.get("key-" + (index + 7))];
    console.log(name, "map", map.size, checksum(tenth.map(String)), tenth.slice(0, 3).join(), absent.join());
  }
}

function growSet(name: string, keyOf: (index: number) => TableKey): void {
  const set = new Set<TableKey>();
  for (let index = 0; index < 5000; index++) {
    set.add(keyOf(index));
    if (!checkpoints.includes(index + 1)) continue;
    let found = 0;
    for (let read = 0; read <= index; read += 10) found += set.has(keyOf(read)) ? 1 : 0;
    console.log(name, "set", set.size, found, set.has(keyOf(index + 1)), set.has("absent"));
  }
}

function shrinkMap(name: string, count: number, keyOf: (index: number) => TableKey): void {
  const map = new Map<TableKey, number>();
  for (let index = 0; index < count; index++) map.set(keyOf(index), index);
  let deleted = 0;
  for (let index = 0; index < count; index += 3) deleted += map.delete(keyOf(index)) ? 1 : 0;
  const afterDelete = [map.size, deleted, map.has(keyOf(0)), map.delete(keyOf(0)), map.get(keyOf(count - 1))];
  console.log(name, "map shrunk", count, afterDelete.join(), listMap(map));
  for (let index = 0; index < count; index += 3) map.set(keyOf(index), -index);
  for (let index = 1; index < count; index += 3) map.set(keyOf(index), index + 1);
  console.log(name, "map refilled", count, map.size, listMap(map));
  map.clear();
  const afterClear = [map.size, map.has(keyOf(0))];
  map.set(keyOf(1), 11);
  console.log(name, "map cleared", count, afterClear.join(), listMap(map));
}

function shrinkSet(name: string, count: number, keyOf: (index: number) => TableKey): void {
  const set = new Set<TableKey>();
  for (let index = 0; index < count; index++) set.add(keyOf(index));
  let deleted = 0;
  for (let index = 0; index < count; index += 3) deleted += set.delete(keyOf(index)) ? 1 : 0;
  console.log(name, "set shrunk", count, set.size, deleted, set.has(keyOf(0)), listSet(set));
  for (let index = 0; index < count; index += 3) set.add(keyOf(index));
  console.log(name, "set refilled", count, set.size, listSet(set));
  set.clear();
  const sizeAfterClear = set.size;
  set.add(keyOf(1));
  console.log(name, "set cleared", count, sizeAfterClear, listSet(set));
}

function readSmallTables(): void {
  let found = 0;
  let absent = 0;
  for (let first = 0; first < 1000; first += 8) {
    const map = new Map<string, number>();
    const set = new Set<string>();
    for (let index = first; index < first + 8; index++) {
      map.set("tag-" + index, index);
      set.add("tag-" + index);
    }
    for (let index = first; index < first + 8; index++) {
      if (map.get("tag-" + index) === index && set.has("tag-" + index)) found++;
      if (!map.has("tag-" + (index + 1000)) && !set.has("tag-" + (index + 1000))) absent++;
    }
  }
  console.log("tables of eight", found, absent);
}

function readKeysBuiltFromParts(): void {
  const map = new Map<string, number>();
  for (let index = 0; index < 1000; index++) map.set("part-" + index, index);
  let sum = 0;
  for (let index = 0; index < 1000; index += 7) {
    const padded = "padding-part-" + index + "-padding";
    const substring = padded.slice(8, padded.length - 8);
    const rope = ["pa", "rt-"].join("") + index;
    sum += (map.get(substring) ?? -1) + (map.get(rope) ?? -1);
  }
  const wide = "part-Ā";
  console.log("keys built from parts", sum, map.has(wide), map.has(wide.slice(0, 5)));
}

growMap("strings", stringKey);
growSet("strings", stringKey);
growMap("mixed", mixedKey);
growSet("mixed", mixedKey);
for (const count of checkpoints) {
  shrinkMap("strings", count, stringKey);
  shrinkSet("strings", count, stringKey);
  shrinkMap("mixed", count, mixedKey);
  shrinkSet("mixed", count, mixedKey);
}
readSmallTables();
readKeysBuiltFromParts();
