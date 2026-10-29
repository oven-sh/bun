// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
const show = (value: unknown): string =>
  Object.is(value, -0)
    ? "-0"
    : typeof value === "string" || (typeof value === "object" && value !== null)
      ? JSON.stringify(value)
      : String(value);
const report = (label: string, probe: () => unknown): void => {
  let text: string;
  try {
    text = show(probe());
  } catch (error) {
    text = "threw " + (error as Error).constructor.name;
  }
  console.log(label + ": " + text);
};
function walkMap(map: Map<number, string>, change: (map: Map<number, string>, key: number) => void): unknown {
  const visited: number[] = [];
  map.forEach((_, key) => {
    visited.push(key);
    change(map, key);
  });
  return [visited.length, visited.slice(0, 6), visited.at(-1), map.size];
}
function walkSet(set: Set<number>, change: (set: Set<number>, key: number) => void): unknown {
  const visited: number[] = [];
  set.forEach(key => {
    visited.push(key);
    change(set, key);
  });
  return [visited.length, visited.slice(0, 6), visited.at(-1), set.size];
}
const createMap = () =>
  new Map([
    [1, "a"],
    [2, "b"],
    [3, "c"],
    [4, "d"],
  ]);
const createSet = () => new Set([1, 2, 3, 4]);
report("map cleared", () => walkMap(createMap(), m => m.clear()));
report("map refilled", () =>
  walkMap(createMap(), (m, k) => {
    if (k === 1) {
      m.clear();
      m.set(9, "i");
    }
  }),
);
report("map grown", () =>
  walkMap(createMap(), m => {
    for (let n = 100; n < 200; n++) m.set(n, "n");
  }),
);
report("map without its next key", () =>
  walkMap(createMap(), (m, k) => {
    m.delete(k + 1);
  }),
);
report("map without its current key", () =>
  walkMap(createMap(), (m, k) => {
    m.delete(k);
  }),
);
report("set cleared", () => walkSet(createSet(), s => s.clear()));
report("set refilled", () =>
  walkSet(createSet(), (s, k) => {
    if (k === 1) {
      s.clear();
      s.add(9);
    }
  }),
);
report("set grown", () =>
  walkSet(createSet(), s => {
    for (let n = 100; n < 200; n++) s.add(n);
  }),
);
report("set without its next key", () =>
  walkSet(createSet(), (s, k) => {
    s.delete(k + 1);
  }),
);
report("set without its current key", () =>
  walkSet(createSet(), (s, k) => {
    s.delete(k);
  }),
);
