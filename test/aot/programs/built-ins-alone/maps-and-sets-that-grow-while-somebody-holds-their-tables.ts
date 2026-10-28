interface Held {
  id: number;
  label: string;
}
const lines: string[] = [];
function make(id: number): Held {
  return { id, label: "held" + id };
}
function text(value: unknown): string {
  return typeof value === "object" && value !== null ? (value as Held).label : String(value);
}
function valueOfKind(kind: number, i: number): Held | number | string | boolean | null | undefined {
  switch (kind) {
    case 0:
      return make(i);
    case 1:
      return i * 1.5;
    case 2:
      return "text" + i;
    case 3:
      return i % 3 === 0 ? undefined : i % 3 === 1 ? null : i % 2 === 0;
    default:
      return i % 5 === 4 ? i : make(i);
  }
}

for (let kind = 0; kind < 5; kind++) {
  const map = new Map<string, unknown>();
  const set = new Set<string>();
  let sum = 0;
  for (let i = 0; i < 140; i++) {
    map.set("k" + i, valueOfKind(kind, i));
    set.add("k" + i);
    if (map.size !== i + 1 || set.size !== i + 1) lines.push(`sizes ${kind} ${i}: ${map.size} ${set.size}`);
    for (let earlier = 0; earlier <= i; earlier += 1 + (i >> 3)) {
      if (!set.has("k" + earlier) || text(map.get("k" + earlier)) !== text(valueOfKind(kind, earlier))) lines.push(`lost ${kind} ${i} ${earlier}`);
    }
    if (map.has("k" + (i + 1)) || set.has("k" + (i + 1))) lines.push(`early ${kind} ${i}`);
    sum += i;
    if (i % 37 === 36) Bun.gc(true);
  }
  lines.push(`kind ${kind}: ${sum} ${[...map.keys()].join("") === [...set].join("")} ${[...map.values()].map(text).join(",").length}`);
}

for (const first of [0, 1, 3, 4, 7, 8, 13, 14, 21, 22, 40, 63, 64]) {
  const map = new Map<string, number | Held>();
  const set = new Set<string>();
  for (let i = 0; i < first; i++) {
    map.set("a" + i, make(i));
    set.add("a" + i);
  }
  const untouchedKeys = map.keys();
  const untouchedValues = set.values();
  const started = map.entries();
  const startedAt = first ? started.next().value![0] : "none";
  for (let i = 0; i < 30; i++) {
    map.set("b" + i, make(100 + i));
    set.add("b" + i);
  }
  lines.push(`held ${first}: ${[...untouchedKeys].length} ${[...untouchedValues].length} ${startedAt} ${[...started].length}`);
}

const walked = new Map<string, number>();
walked.set("w0", 0);
const order: string[] = [];
for (const [key, value] of walked) {
  order.push(key);
  if (value < 90) walked.set("w" + (value + 1), value + 1);
}
lines.push(`walked ${order.length} ${order[0]} ${order[order.length - 1]} ${walked.size}`);
const walkedSet = new Set<string>(["s0"]);
let steps = 0;
walkedSet.forEach(key => {
  steps++;
  if (steps < 70) walkedSet.add("s" + steps);
  if (steps % 9 === 0) walkedSet.delete(key);
});
lines.push(`walked set ${steps} ${walkedSet.size}`);

const mixed = new Map<unknown, unknown>();
const symbol = Symbol("key");
const object = make(7);
const others: unknown[] = [object, symbol, undefined, null, true, 12, 1.5, -0, NaN, 10n ** 30n];
for (let round = 0; round < others.length; round++) {
  const map = new Map<unknown, unknown>();
  const set = new Set<unknown>();
  for (let i = 0; i < 70; i++) {
    if (i === round * 3) {
      map.set(others[round], "other");
      set.add(others[round]);
    }
    map.set("m" + i, i);
    set.add("m" + i);
  }
  mixed.set(others[round], map.get(others[round]));
  lines.push(`mixed ${round}: ${map.size} ${set.size} ${set.has(others[round])} ${map.get(others[round])} ${map.get("m69")} ${[...map.keys()].findIndex(key => typeof key !== "string")}`);
}
lines.push(`mixed ${mixed.size}`);

for (const gap of [1, 2, 3, 5]) {
  const map = new Map<string, Held>();
  const set = new Set<string>();
  for (let i = 0; i < 100; i++) {
    map.set("d" + i, make(i));
    set.add("d" + i);
    if (i % gap === 0 && i > 2) {
      map.delete("d" + (i - 2));
      set.delete("d" + (i - 2));
    }
  }
  lines.push(`deleted ${gap}: ${map.size} ${set.size} ${[...map.values()].reduce((sum, held) => sum + held.id, 0)} ${[...set].length}`);
}

const many: Map<string, Held>[] = [];
let total = 0;
for (let turn = 0; turn < 4000; turn++) {
  const map = new Map<string, Held>();
  const count = (turn * 13) % 23;
  for (let i = 0; i < count; i++) map.set("t" + ((turn + i * 7) % 40), make(turn + i));
  total += map.size;
  if (turn % 16 === 0) many.push(map);
  if (turn % 1000 === 999) Bun.gc(true);
}
for (const map of many) {
  for (let i = 0; i < 12; i++) map.set("late" + i, make(i));
  for (const held of map.values()) total += held.id & 7;
}
lines.push(`many ${total} ${many.length}`);
console.log(lines.join("\n"));
