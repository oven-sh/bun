// A counted loop adds to a Map or a Set: every way to write the count, additions that are skipped or repeat a key, several a turn, and additions that reach the loop through a call.
const lines: string[] = [];
function show(label: string, collection: Set<unknown> | Map<unknown, unknown>) {
  const keys = [...collection.keys()];
  let sum = 0;
  for (const key of keys) sum = (sum * 31 + (typeof key === "number" ? key : String(key).length)) % 1000003;
  lines.push(`${label}: ${collection.size} ${String(keys[0])} ${String(keys.at(-1))} ${sum}`);
}

function upTo(n: number) {
  const set = new Set<number>();
  for (let i = 0; i < n; i++) set.add(i);
  return set;
}
function through(map: Map<number, number>, extra: number) {
  const n = 1000 + (extra & 255);
  for (let i = 1; i <= n; i++) map.set(i, i);
  return map;
}
function between(from: number, to: number) {
  const a = 10 + (from & 15);
  const b = 100 + (to & 1023);
  const set = new Set<number>();
  for (let i = a; i < b; i++) set.add(i);
  return set;
}
function down(extra: number) {
  const n = 64 + (extra & 63);
  const strictly = new Set<number>();
  const toZero = new Set<number>();
  for (let i = n; i > 0; i--) strictly.add(i);
  for (let i = n; i >= 0; i--) toZero.add(i);
  return [strictly, toZero];
}
function underCondition(rows: { ok: boolean; id: number }[]) {
  const seen = new Set<number>();
  for (let i = 0; i < 3000; i++) if (rows[i % rows.length]!.ok) seen.add(i);
  return seen;
}
function repeating() {
  const seen = new Set<number>();
  for (let i = 0; i < 100000; i++) seen.add(i % 10);
  return seen;
}
function twoATurn() {
  const index = new Map<string | number, number>();
  for (let i = 0; i < 5000; i++) {
    index.set(i, i);
    index.set("s" + i, i);
  }
  return index;
}
function sameKeyTwice() {
  const index = new Map<number, number>();
  for (let i = 0; i < 5000; i++) {
    index.set(i, i);
    index.set(i, -i);
  }
  return index;
}
const note = (set: Set<number>, value: number) => {
  set.add(value);
};
const noteOdd = (set: Set<number>, value: number) => {
  if (value & 1) set.add(value);
};
function throughHelpers() {
  const all = new Set<number>();
  const odd = new Set<number>();
  for (let i = 0; i < 1000; i++) {
    note(all, i);
    noteOdd(odd, i);
  }
  return [all, odd];
}
function throughCallback(list: number[]) {
  const seen = new Set<number>();
  for (let i = 0; i < 40; i++) list.forEach(value => seen.add(value * 100 + i));
  return seen;
}
function nested() {
  const pairs = new Map<number, number>();
  for (let i = 0; i < 50; i++) for (let j = 0; j < 50; j++) pairs.set(i * 50 + j, j);
  return pairs;
}
function endsEarly() {
  const set = new Set<number>();
  for (let i = 0; i < 100000; i++) {
    if (i === 37) break;
    set.add(i);
  }
  return set;
}
function addsInFrontOfTest(start: number) {
  const set = new Set<number>();
  for (let i = start; ; i++) {
    set.add(i);
    set.add(-i - 1);
    if (!(i < 100)) break;
  }
  return set;
}
function madeInLoop() {
  let last = new Set<number>();
  for (let i = 0; i < 100; i++) {
    last = new Set<number>();
    last.add(i);
  }
  return last;
}
function addsAndDeletes() {
  const window = new Set<number>();
  for (let i = 0; i < 2000; i++) {
    window.add(i);
    if (i >= 8) window.delete(i - 8);
  }
  return window;
}
function throwsHalfWay() {
  const set = new Set<number>();
  try {
    for (let i = 0; i < 1000; i++) {
      if (i === 500) throw new Error("stop");
      set.add(i);
    }
  } catch {
    set.add(-1);
  }
  return set;
}
function ontoConstants() {
  const words = new Set(["if", "for", "let"]);
  for (let i = 0; i < 200; i++) words.add("w" + (i % 150));
  const ranks = new Map([
    ["+", 1],
    ["*", 2],
  ]);
  for (let i = 0; i < 200; i++) ranks.set(i % 2 ? "+" : "r" + i, i);
  return [words, ranks] as const;
}
function walkedWhileAdding() {
  const set = new Set<number>([0]);
  for (const value of set) {
    for (let i = 0; i < 40; i++) if (set.size < 500) set.add(value * 40 + i);
  }
  return set;
}
function* yielding(set: Set<number>) {
  for (let i = 0; i < 100; i++) {
    set.add(i);
    if (i % 25 === 0) yield i;
  }
}
async function awaiting(map: Map<number, number>) {
  for (let i = 0; i < 100; i++) {
    map.set(i, i);
    if (i % 25 === 0) await null;
  }
  return map;
}

for (const n of [0, 1, 31, 32, 33, 1000, -5]) show("up to " + n, upTo(n));
show("constant count", (() => { const set = new Set<number>(); for (let i = 0; i < 100000; i++) set.add(i); return set; })());
show("through", through(new Map(), 77));
show("through, onto entries", through(new Map([[-1, 0], [5, 0]]), 3));
show("between", between(3, 700));
down(9).forEach((set, index) => show("down " + index, set));
show("under a condition", underCondition([{ ok: true, id: 1 }, { ok: false, id: 2 }, { ok: false, id: 3 }]));
show("never", underCondition([{ ok: false, id: 1 }]));
show("repeating", repeating());
show("two a turn", twoATurn());
show("same key twice", sameKeyTwice());
throughHelpers().forEach((set, index) => show("helper " + index, set));
show("callback", throughCallback([1, 2, 3]));
show("nested", nested());
show("ends early", endsEarly());
show("adds in front of the test", addsInFrontOfTest(0));
show("adds in front of a test that fails at once", addsInFrontOfTest(500));
show("made in the loop", madeInLoop());
show("adds and deletes", addsAndDeletes());
show("throws half way", throwsHalfWay());
ontoConstants().forEach((collection, index) => show("onto constants " + index, collection));
show("walked while adding", walkedWhileAdding());
const yielded = new Set<number>();
for (const at of yielding(yielded)) if (at === 50) yielded.delete(0);
show("yielding", yielded);
const awaited = new Map<number, number>();
const running = awaiting(awaited);
awaited.set(1000, 0);
show("awaiting", await running);
console.log(lines.join("\n"));
export {};
