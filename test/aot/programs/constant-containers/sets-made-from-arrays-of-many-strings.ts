function say(name: string, f: () => unknown) {
  let text: string;
  try {
    text = JSON.stringify(f()) ?? "undefined";
  } catch (error) {
    text = "throws " + (error as Error).constructor.name;
  }
  console.log(name + ": " + text);
}

function make(list: string[]): Set<string> {
  return new Set(list);
}

function joined(a: string, b: string): string {
  return a + b;
}

let seed = 12345;
function random(below: number): number {
  seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
  return (seed >>> 8) % below;
}

function distinct(list: string[]): string[] {
  const seen: Record<string, boolean> = Object.create(null);
  const kept: string[] = [];
  for (const item of list) {
    if (seen[item]) continue;
    seen[item] = true;
    kept.push(item);
  }
  return kept;
}

function sum(text: string): number {
  let total = 0;
  for (let i = 0; i < text.length; i++) total = (Math.imul(total, 31) + text.charCodeAt(i)) | 0;
  return total;
}

for (const length of [9, 10, 11, 16, 17, 63, 64, 65, 190, 191, 253, 254, 255, 256, 257, 1000, 5000]) {
  say("of " + length, () => {
    const list: string[] = [];
    for (let i = 0; i < length; i++) list.push("key" + i);
    const set = make(list);
    return [set.size, sum([...set].join()), set.has("key0"), set.has("key" + (length - 1)), set.has("key" + length), set.has("")];
  });
}
say("few names drawn many times", () => {
  let agreed = 0;
  let total = 0;
  for (let round = 0; round < 400; round++) {
    const length = 1 + random(40);
    const names = 1 + random(30);
    const list: string[] = [];
    for (let i = 0; i < length; i++) list.push("n" + random(names));
    const set = make(list);
    if ([...set].join() === distinct(list).join()) agreed++;
    total += set.size;
  }
  return [agreed, total];
});
say("eight of many names, so that some share the start of their hashes", () => {
  let agreed = 0;
  let found = 0;
  for (let round = 0; round < 3000; round++) {
    const list: string[] = [];
    for (let i = 0; i < 8; i++) list.push("name" + random(100000));
    const set = make(list);
    if ([...set].join() === distinct(list).join()) agreed++;
    for (const item of list) if (set.has(item)) found++;
    if (set.has("name")) found = -1000000;
  }
  return [agreed, found];
});
say("the same text in other cells, far apart", () => {
  const list: string[] = [];
  for (let i = 0; i < 50; i++) list.push("k" + i);
  for (let i = 0; i < 50; i++) list.push(joined("k", String(i)));
  const set = make(list);
  return [set.size, sum([...set].join())];
});
say("a rope among many", () => {
  const long = "a long text that is surely kept as a rope until somebody asks for its characters";
  const list: string[] = [];
  for (let i = 0; i < 20; i++) list.push("k" + i);
  list.push(joined(long, "1"), joined(long, "2"), joined(long, "1"));
  const set = make(list);
  return [set.size, set.has(long + "1"), set.has(long + "3"), [...set].length];
});
say("parts of a text", () => {
  const words: string[] = [];
  for (let i = 0; i < 300; i++) words.push("w" + (i % 120));
  const set = make(words.join(" ").split(" "));
  return [set.size, sum([...set].join()), set.has("w119"), set.has("w120")];
});
say("wide ones among many", () => {
  const list: string[] = [];
  for (let i = 0; i < 30; i++) list.push(i % 3 ? "é" + (i % 7) : "日本" + (i % 5));
  list.push("", "", "\u{1F600}");
  const set = make(list);
  return [set.size, [...set], set.has("日本0"), set.has("日本")];
});
say("it grows afterwards", () => {
  const list: string[] = [];
  for (let i = 0; i < 12; i++) list.push("a" + i);
  const set = make(list);
  for (let i = 0; i < 600; i++) set.add("k" + (i % 300));
  return [set.size, sum([...set].join()), set.has("k299"), set.has("k300"), set.has("a11")];
});
say("eight, then a ninth", () => {
  const set = make(["a", "b", "c", "d", "e", "f", "g", "h"]);
  set.add("i");
  set.add("a");
  return [set.size, [...set].join("")];
});
say("five that are two, then more", () => {
  const set = make(["a", "b", "a", "b", "a"]);
  const before = [...set].join("");
  for (const more of ["c", "d", "e", "f"]) set.add(more);
  return [before, set.size, [...set].join("")];
});
say("deleted, added again, cleared", () => {
  const list: string[] = [];
  for (let i = 0; i < 20; i++) list.push("a" + i);
  const set = make(list);
  const first = [set.delete("a7"), set.delete("a7"), set.size, sum([...set].join())];
  set.add("a7");
  const second = [...set].join();
  set.clear();
  set.add("z");
  return [first, second, [...set]];
});
say("changed while it is walked", () => {
  const list: string[] = [];
  for (let i = 0; i < 10; i++) list.push("a" + i);
  const set = make(list);
  const seen: string[] = [];
  for (const key of set) {
    seen.push(key);
    if (key === "a0") set.delete("a1");
    if (key === "a9" && seen.length < 14) set.add("x" + seen.length);
  }
  return seen;
});
say("the array is not touched, and changes to it do not reach the set", () => {
  const list: string[] = [];
  for (let i = 0; i < 10; i++) list.push("a" + i);
  const set = make(list);
  list.push("c");
  list[0] = "z";
  return [list.join(), [...set].join()];
});
say("a frozen array, and one written in the program", () => {
  const frozen = Object.freeze(["a", "b", "c", "a"]) as string[];
  const written = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "one"];
  return [[...make(frozen)], [...make(written)]];
});
say("other values among many take the other way", () => {
  const mixed: any[] = [];
  for (let i = 0; i < 12; i++) mixed.push("a" + i);
  mixed.push(1, "1", null, undefined, 1, true);
  const holes: any[] = [];
  for (let i = 0; i < 12; i++) holes[i * 2] = "a" + i;
  const last: any[] = ["a", "b", "c", 4];
  return [[...make(mixed)], make(holes).size, make(holes).has(undefined as any), [...make(last)]];
});
say("an array with an iterator of its own", () => {
  const own = ["a", "b", "c"];
  (own as any)[Symbol.iterator] = function* () {
    yield "z";
    yield "y";
  };
  const many: string[] = [];
  for (let i = 0; i < 12; i++) many.push("a" + i);
  (many as any)[Symbol.iterator] = function* () {
    yield "only";
  };
  return [[...make(own)], [...make(many)]];
});
say("an heir of Array with an iterator of its own", () => {
  class Backwards extends Array<string> {
    *[Symbol.iterator](): ArrayIterator<string> {
      for (let i = this.length - 1; i >= 0; i--) yield this[i];
    }
  }
  const list = new Backwards();
  list.push("a", "b", "c");
  class Plain extends Array<string> {}
  const plain = new Plain();
  plain.push("p", "q", "p");
  return [[...make(list)], [...make(plain)]];
});
say("an array with another prototype", () => {
  const list = ["a", "b"];
  Object.setPrototypeOf(list, {
    *[Symbol.iterator]() {
      yield "from the prototype";
    },
  });
  return [...make(list)];
});
say("many, kept", () => {
  const kept: Set<string>[] = [];
  let total = 0;
  for (let i = 0; i < 20000; i++) {
    const list: string[] = [];
    for (let k = 0; k < 10; k++) list.push("k" + ((i + k * 7) & 15));
    const set = make(list);
    total += set.size;
    if (i % 2000 === 0) kept.push(set);
  }
  return [total, kept.map((set) => [...set].join("|"))];
});
