// structuredClone and postMessage of Maps and Sets that getters change during the clone: entries, order, identity and errors are plain Bun's.
import { MessageChannel, receiveMessageOnPort } from "node:worker_threads";

type Key = string | number | bigint | boolean | object | null | undefined;
type Copier = (value: unknown) => any;

let count = 0;
function text(value: unknown): string {
  return Bun.inspect(value, { depth: 6, sorted: false }).replace(/\s+/g, " ");
}
function show(name: string, make: () => unknown) {
  let out: string;
  try {
    out = text(make());
  } catch (e) {
    out = "THROWN " + (e as Error).name + ": " + (e as Error).message;
  }
  console.log(String(++count).padStart(3, "0"), name + ":", out);
}
function post(value: unknown): any {
  const { port1, port2 } = new MessageChannel();
  try {
    port1.postMessage(value);
    return receiveMessageOnPort(port2)?.message;
  } finally {
    port1.close();
    port2.close();
  }
}
const copiers: [string, Copier][] = [
  ["structuredClone", value => structuredClone(value)],
  ["postMessage", post],
];

function summarize(entries: unknown[]): string {
  const parts = entries.map(text);
  if (parts.length <= 12) return parts.join(" ");
  return `${parts.slice(0, 6).join(" ")} .. ${parts.slice(-4).join(" ")} (${parts.length})`;
}

function runOnce(action: () => void) {
  let hasRun = false;
  return {
    get ran() {
      if (!hasRun) {
        hasRun = true;
        action();
      }
      return true;
    },
  };
}

const sizes = [1, 3, 8, 9, 64];
const sharedKey = { label: "shared" };
const otherKeys: Key[] = [1.5, NaN, -0, 10n, sharedKey, undefined, null, true, 2147483648, ""];

function positions(size: number): number[] {
  return [...new Set([0, size >> 1, size])];
}

function createMap(size: number, position: number, trigger: unknown): Map<Key, unknown> {
  const map = new Map<Key, unknown>();
  for (let index = 0; index <= size; index++) {
    if (index === position) map.set("trigger", trigger);
    if (index < size) map.set("key-" + index, index);
  }
  return map;
}

function createSet(size: number, position: number, trigger: object): Set<Key> {
  const set = new Set<Key>();
  for (let index = 0; index <= size; index++) {
    if (index === position) set.add(trigger);
    if (index < size) set.add("key-" + index);
  }
  return set;
}

const mapChanges: [string, (map: Map<Key, unknown>, size: number) => void][] = [
  ["adds one entry", map => void map.set("late", 1)],
  [
    "adds 500 entries",
    map => {
      for (let index = 0; index < 500; index++) map.set("late-" + index, index);
    },
  ],
  [
    "adds keys of other kinds",
    map => {
      for (const key of otherKeys) map.set(key, typeof key);
    },
  ],
  ["deletes the first entry", map => void map.delete("key-0")],
  ["deletes the last entry", (map, size) => void map.delete("key-" + (size - 1))],
  [
    "deletes every other entry",
    (map, size) => {
      for (let index = 0; index < size; index += 2) map.delete("key-" + index);
    },
  ],
  ["deletes its own entry", map => void map.delete("trigger")],
  ["replaces the last value", (map, size) => void map.set("key-" + (size - 1), "replaced")],
  [
    "deletes the first entry and adds it again",
    map => {
      map.delete("key-0");
      map.set("key-0", "again");
    },
  ],
  ["clears", map => map.clear()],
  [
    "clears and adds two entries",
    map => {
      map.clear();
      map.set("after", 1);
      map.set("after-2", 2);
    },
  ],
];

const setChanges: [string, (set: Set<Key>, size: number, trigger: object) => void][] = [
  ["adds one key", set => void set.add("late")],
  [
    "adds 500 keys",
    set => {
      for (let index = 0; index < 500; index++) set.add("late-" + index);
    },
  ],
  [
    "adds keys of other kinds",
    set => {
      for (const key of otherKeys) set.add(key);
    },
  ],
  ["deletes the first key", set => void set.delete("key-0")],
  ["deletes the last key", (set, size) => void set.delete("key-" + (size - 1))],
  [
    "deletes every other key",
    (set, size) => {
      for (let index = 0; index < size; index += 2) set.delete("key-" + index);
    },
  ],
  ["deletes its own key", (set, size, trigger) => void set.delete(trigger)],
  [
    "deletes the first key and adds it again",
    set => {
      set.delete("key-0");
      set.add("key-0");
    },
  ],
  ["clears", set => set.clear()],
  [
    "clears and adds two keys",
    set => {
      set.clear();
      set.add("after");
      set.add("after-2");
    },
  ],
];

class Registry extends Map<string, number> {
  label = "registry";
  total() {
    let sum = 0;
    for (const value of this.values()) sum += value;
    return sum;
  }
}
class Tags extends Set<string> {
  label = "tags";
}

for (const [via, copy] of copiers) {
  for (const size of [0, ...sizes, 300]) {
    show(`${via}, map of ${size}`, () => {
      const clone = copy(createMap(size, -1, null));
      return [summarize([...clone]), clone.size, clone instanceof Map];
    });
    show(`${via}, set of ${size}`, () => {
      const clone = copy(createSet(size, -1, sharedKey));
      return [summarize([...clone]), clone.size, clone instanceof Set];
    });
  }

  for (const size of sizes) {
    for (const position of positions(size)) {
      for (const [change, apply] of mapChanges) {
        show(`${via}, map of ${size}, entry ${position} ${change}`, () => {
          const map: Map<Key, unknown> = createMap(
            size,
            position,
            runOnce(() => apply(map, size)),
          );
          const clone = copy(map);
          return [summarize([...clone]), clone.size, map.size];
        });
      }
      for (const [change, apply] of setChanges) {
        show(`${via}, set of ${size}, key ${position} ${change}`, () => {
          const trigger: object = runOnce(() => apply(set, size, trigger));
          const set: Set<Key> = createSet(size, position, trigger);
          const clone = copy(set);
          return [summarize([...clone]), clone.size, set.size];
        });
      }
    }
  }

  show(`${via}, keys of every kind`, () => {
    const map = new Map<Key, unknown>();
    for (const key of otherKeys) map.set(key, typeof key);
    const clone = copy([map, new Set(otherKeys)]);
    return [clone, Object.is([...clone[0].keys()][2], 0), clone[0].get(NaN), clone[1].has(sharedKey)];
  });
  show(`${via}, nested`, () =>
    copy(
      new Map<Key, unknown>([
        ["map", new Map([[1, new Set<unknown>([2, new Map([[3, 4]])])]])],
        [new Set(["key"]), new Map()],
        ["list", [new Set(), new Map([["a", { b: new Set([1]) }]])]],
      ]),
    ),
  );
  show(`${via}, one map three times`, () => {
    const inner = new Map([[1, 2]]);
    const clone = copy(
      new Map<Key, unknown>([
        ["a", inner],
        ["b", inner],
        [inner, inner],
      ]),
    );
    return [clone.get("a") === clone.get("b"), [...clone.keys()][2] === clone.get("a"), clone.get("a") === inner];
  });
  show(`${via}, a map that holds itself`, () => {
    const map = new Map<Key, unknown>();
    map.set("self", map);
    map.set(map, 1);
    const clone = copy(map);
    return [clone.get("self") === clone, clone.get(clone), clone === map, clone.size];
  });
  show(`${via}, a set that holds itself`, () => {
    const set = new Set<Key>(["first"]);
    set.add(set);
    const clone = copy(set);
    return [clone.has(clone), clone.has(set), clone.size];
  });
  show(`${via}, own properties`, () => {
    const map: any = new Map([[1, 2]]);
    map.extra = { deep: [1] };
    const set: any = new Set([1]);
    set.extra = "text";
    const clones = [copy(map), copy(set)];
    return [clones[0].extra, [...clones[0]], clones[1].extra, [...clones[1]]];
  });
  show(`${via}, subclasses`, () => {
    const registry = new Registry([
      ["a", 1],
      ["b", 2],
    ]);
    const clones = [copy(registry), copy(new Tags(["x", "y"]))];
    return [
      registry.total(),
      clones[0] instanceof Registry,
      clones[0] instanceof Map,
      clones[0].label,
      [...clones[0]],
      clones[1] instanceof Tags,
      clones[1] instanceof Set,
      clones[1].label,
      [...clones[1]],
    ];
  });
  show(`${via}, an inner map changes the outer one`, () => {
    const outer = new Map<Key, unknown>();
    const inner = new Map<Key, unknown>([
      ["before", 1],
      [
        "trigger",
        runOnce(() => {
          outer.set("late", 2);
          outer.delete("doomed");
          for (let index = 0; index < 40; index++) outer.set(index, index);
        }),
      ],
      ["after", 3],
    ]);
    outer.set("inner", inner);
    outer.set("doomed", 0);
    outer.set("kept", 1);
    const clone = copy(outer);
    return [summarize([...clone]), clone.size];
  });
  show(`${via}, an outer set changes an inner map it has passed`, () => {
    const inner = new Map<Key, unknown>([["a", 1]]);
    const outer = new Set<Key>([inner, runOnce(() => inner.set("late", 2)), inner]);
    return [copy(outer), inner.size];
  });
  show(`${via}, the program's own iterators keep their place`, () => {
    const map = createMap(4, -1, null);
    const set = createSet(4, -1, sharedKey);
    const entries = map.entries();
    const keys = set.values();
    entries.next();
    keys.next();
    copy([map, set]);
    return [entries.next().value, keys.next().value, [...entries].length, [...keys].length];
  });
  show(`${via}, a function among the values`, () =>
    copy(
      new Map<Key, unknown>([
        ["a", 1],
        ["b", () => 1],
        ["c", 3],
      ]),
    ),
  );
  show(`${via}, a symbol among the keys`, () => copy(new Set<unknown>([1, Symbol("s"), 3])));
  show(`${via}, a getter that throws`, () => {
    const map = createMap(
      5,
      2,
      runOnce(() => {
        throw new RangeError("stop");
      }),
    );
    try {
      copy(map);
    } catch (e) {
      return [(e as Error).name, (e as Error).message, [...map.keys()], summarize([...copy(map)])];
    }
    return "no error";
  });
}
