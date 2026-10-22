// A typed function asks a Map and a Set, makes a call and asks them again. Below the call entries come and go, and in one round `get` is hidden behind an own property of the map.
let mode = 0;
function below(map: Map<string, number>, set: Set<number>): number {
  if (mode === 1) {
    map.set("a", 100);
    set.delete(1);
  } else if (mode === 2) {
    map.clear();
    set.add(50);
  } else if (mode === 3) {
    (map as any).get = () => -1;
    Object.defineProperty(set, "size", { get: () => -2 });
  }
  return 1;
}

function holder(map: Map<string, number>, set: Set<number>): string {
  const before = map.get("a") + "," + map.size + "," + set.has(1) + "," + set.size;
  const got = below(map, set);
  return before + " " + got + " " + map.get("a") + "," + map.size + "," + set.has(1) + "," + set.size;
}

for (let round = 0; round < 400; round++) {
  mode = round % 100 === 99 ? (round + 1) / 100 : 0;
  const line = holder(new Map([["a", round], ["b", 2]]), new Set([1, 2, 3]));
  if (mode || round === 0) console.log(round + ": " + line);
}
