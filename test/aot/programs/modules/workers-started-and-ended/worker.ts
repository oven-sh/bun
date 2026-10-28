// What one thread of start.ts runs: classes, closures, a generator, 3,000 string keys built at run time, and a module variable that points to a young object across a full collection. As a program of its own it runs once, on the main thread.
const stringKeyCount = 3000;

class Entry {
  key: string;
  value: number;
  next: Entry | null;
  constructor(key: string, value: number, next: Entry | null) {
    this.key = key;
    this.value = value;
    this.next = next;
  }
}

class Point {
  x: number;
  y: number;
  label: string | null;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
    this.label = null;
  }
}

let newestEntry: Entry | null = null;

function mix(checksum: number, value: number): number {
  return (Math.imul(checksum, 31) + value) | 0;
}

function classChecksum(seed: number): number {
  let checksum = 0;
  for (let n = 0; n < 16; n++) {
    class Base {
      static instanceCount = 0;
      #id = seed + n;
      constructor() {
        Base.instanceCount++;
      }
      id(): number {
        return this.#id;
      }
    }
    class Derived extends Base {
      scale = n;
      id(): number {
        return super.id() * this.scale;
      }
    }
    checksum = mix(checksum, new Derived().id() + new Base().id() + Base.instanceCount);
  }
  return checksum;
}

function closureChecksum(seed: number): number {
  const counters: (() => number)[] = [];
  for (let n = 0; n < 256; n++) {
    let count = seed + n;
    counters.push(() => ++count);
  }
  let checksum = 0;
  for (const counter of counters) checksum = mix(checksum, counter() + counter());
  return checksum;
}

function* stringKeys(seed: number): Generator<string> {
  for (let n = 0; n < stringKeyCount; n++) yield "key" + seed + "_" + n;
}

function stringKeyChecksum(seed: number): number {
  const indexByKey: Record<string, number> = {};
  const indexMap = new Map<string, number>();
  let index = 0;
  for (const key of stringKeys(seed)) {
    indexByKey[key] = index;
    indexMap.set(key, index);
    if (index % 100 === 0) newestEntry = new Entry(key, index, newestEntry);
    index++;
  }
  newestEntry = new Entry("newest", seed, newestEntry);
  Bun.gc(true);
  let checksum = 0;
  for (const key of stringKeys(seed)) checksum = mix(checksum, indexByKey[key] + indexMap.get(key)!);
  for (let entry: Entry | null = newestEntry; entry; entry = entry.next) {
    checksum = mix(checksum, entry.value + entry.key.length);
  }
  return checksum;
}

function objectKeyChecksum(seed: number): number {
  const point: any = new Point(seed, 2);
  point.undeclared = seed;
  Object.assign(point, { y: seed + 1, other: 2 });
  const keysBeforeDelete = Object.keys(point).join();
  delete point.label;
  return keysBeforeDelete.length + Object.keys(point).length + point.x + point.y + point.undeclared + point.other;
}

function work(seed: number): number {
  newestEntry = null;
  let checksum = classChecksum(seed);
  checksum = mix(checksum, closureChecksum(seed));
  checksum = mix(checksum, stringKeyChecksum(seed));
  return mix(checksum, objectKeyChecksum(seed));
}

if (Bun.isMainThread) {
  console.log("main thread: " + work(1));
} else if (process.argv[2] === "endless") {
  postMessage("started");
  for (let seed = Number(process.argv[3]); ; seed++) work(seed);
} else {
  const seed = Number(process.argv[3]);
  postMessage("Worker " + seed + ": " + work(seed));
  setInterval(() => {}, 60_000);
}

export {};
