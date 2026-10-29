interface Held {
  id: number;
  label: string;
}
const lines: string[] = [];
function make(id: number): Held {
  return { id, label: "held" + id };
}
function show(name: string, map: Map<string, Held | number | string>, set: Set<string>) {
  const entries: string[] = [];
  for (const [key, value] of map) entries.push(key + "=" + (typeof value === "object" ? value.label : String(value)));
  lines.push(`${name}: ${map.size} ${set.size} [${entries.join(",")}] [${[...set].join(",")}] ${[...map.keys()].length} ${[...map.values()].length}`);
}

const map = new Map<string, Held | number | string>();
const set = new Set<string>();
const sizes = [1, 2, 3, 4, 5, 7, 8, 9, 12, 16, 17, 31, 32, 33, 40, 3, 1, 0, 6];
for (let round = 0; round < sizes.length; round++) {
  const count = sizes[round];
  for (let i = 0; i < count; i++) {
    const key = "k" + round + "_" + i;
    map.set(key, round % 3 === 0 ? make(i) : round % 3 === 1 ? i * 1.5 : "text" + i);
    set.add(key);
  }
  if (count <= 9) show("filled " + round, map, set);
  else lines.push(`filled ${round}: ${map.size} ${set.size} ${map.has("k" + round + "_" + (count - 1))} ${set.has("k" + round + "_0")}`);
  for (let earlier = 0; earlier < round; earlier++) {
    if (map.has("k" + earlier + "_0") || set.has("k" + earlier + "_0") || map.get("k" + earlier + "_0") !== undefined) lines.push("an entry from before the clearing came back: " + earlier);
  }
  map.clear();
  set.clear();
  if (map.size || set.size || map.has("k" + round + "_0") || set.has("k" + round + "_0") || [...map].length || [...set].length) lines.push("not empty behind clear: " + round);
  if (round % 4 === 3) Bun.gc(true);
}
show("at the end", map, set);

const caches: Map<string, Held>[] = [];
for (let i = 0; i < 4; i++) caches.push(new Map());
let sum = 0;
for (let turn = 0; turn < 3000; turn++) {
  const cache = caches[turn & 3];
  const count = (turn * 7) % 6;
  for (let i = 0; i < count; i++) cache.set("t" + ((turn + i) % 50), make(turn + i));
  for (const value of cache.values()) sum += value.id;
  sum += cache.size;
  cache.clear();
  if (turn % 500 === 499) Bun.gc(true);
}
lines.push("turns " + sum);

const walked = new Map<string, number>([["a", 1], ["b", 2], ["c", 3]]);
const seen: string[] = [];
for (const [key] of walked) {
  seen.push(key);
  if (key === "a") {
    walked.clear();
    walked.set("d", 4);
    walked.set("e", 5);
  }
}
lines.push("walked " + seen.join(",") + " " + [...walked.keys()].join(","));
const iterator = walked.keys();
iterator.next();
walked.clear();
walked.set("f", 6);
lines.push("iterator " + JSON.stringify(iterator.next()) + " " + JSON.stringify(iterator.next()));
walked.delete("f");
walked.clear();
walked.set("g", 7);
lines.push("deleted " + [...walked.entries()].join(";") + " " + JSON.stringify(structuredClone(walked).get("g")));
console.log(lines.join("\n"));
