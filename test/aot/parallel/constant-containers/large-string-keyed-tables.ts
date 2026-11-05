interface Box {
  value: number;
}

function checksum(parts: string[]): number {
  let sum = 0;
  for (const part of parts) {
    for (let i = 0; i < part.length; i++) sum = (Math.imul(sum, 31) + part.charCodeAt(i)) | 0;
  }
  return sum;
}

function createKey(index: number): string {
  return "large-key-" + index.toString(36);
}

function createBoxMap(count: number): Map<string, Box> {
  const map = new Map<string, Box>();
  for (let index = 0; index < count; index++) map.set(createKey(index), { value: index });
  return map;
}

function createNumberMap(count: number): Map<string, number> {
  const map = new Map<string, number>();
  for (let index = 0; index < count; index++) map.set(createKey(index), index + 0.5);
  return map;
}

function createSet(count: number): Set<string> {
  const set = new Set<string>();
  for (let index = 0; index < count; index++) set.add(createKey(index));
  return set;
}

function readBoxMap(map: Map<string, Box>, count: number): number {
  let sum = 0;
  for (let index = 0; index < count; index += 13) sum += map.get(createKey(index))?.value ?? -1;
  return sum;
}

function exercise(count: number): void {
  const boxes = createBoxMap(count);
  const numbers = createNumberMap(count);
  const keys = createSet(count);
  Bun.gc(true);
  console.log("after collection", count, boxes.size, numbers.size, keys.size);
  console.log("lookups", count, readBoxMap(boxes, count), numbers.get(createKey(count - 1)), keys.has(createKey(count >> 1)));
  console.log("absent", count, boxes.has(createKey(count)), numbers.get("absent"), keys.has("absent"));

  const spread = [...keys];
  const entries = [...boxes].map(([key, box]) => key + "=" + box.value);
  console.log("spread", count, spread.length, spread[0], spread[count - 1], checksum(spread), checksum(entries));

  for (let index = 0; index < count; index += 2) {
    boxes.delete(createKey(index));
    keys.delete(createKey(index));
  }
  Bun.gc(true);
  for (let index = count; index < count + 100; index++) {
    boxes.set(createKey(index), { value: index });
    keys.add(createKey(index));
  }
  Bun.gc(true);
  console.log("changed", count, boxes.size, keys.size, readBoxMap(boxes, count + 100), checksum([...keys]));

  let visited = 0;
  for (const [key, box] of boxes) {
    if (key !== createKey(box.value)) console.log("wrong entry", key, box.value);
    if (visited === 10) {
      boxes.set(createKey(count + 200), { value: count + 200 });
      Bun.gc(true);
    }
    visited++;
  }
  console.log("iterated", count, visited, boxes.get(createKey(count + 200))?.value);

  boxes.clear();
  numbers.clear();
  keys.clear();
  Bun.gc(true);
  console.log("cleared", count, boxes.size, numbers.size, keys.size, boxes.has(createKey(1)));
}

exercise(100);
exercise(20000);
