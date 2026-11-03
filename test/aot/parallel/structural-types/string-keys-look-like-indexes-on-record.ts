// String keys that look like indexes on a record.
function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return String(value) + "n";
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  const parts: string[] = [];
  if (Array.isArray(value)) {
    const list: unknown[] = value;
    if (list.length > 40) return "array of " + list.length + " with keys " + Object.keys(list).join();
    for (let i = 0; i < list.length; i++) parts.push(i in list ? show(list[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  for (const [key, member] of Object.entries(value)) parts.push(key + ": " + show(member));
  return "{" + parts.join(", ") + "}";
}

function attempt(label: string, run: () => unknown): void {
  let line: string;
  try {
    line = show(run());
  } catch (error) {
    line = "threw " + (error instanceof Error ? error.constructor.name : show(error));
  }
  console.log(label + " -> " + line);
}

function read(record: Record<string, number>, key: string): number {
  return record[key];
}

function write(record: Record<string, number>, key: string, value: number): void {
  record[key] = value;
}

function state(record: object): string {
  return Object.keys(record).join("|") + " " + JSON.stringify(record);
}

let total = 0;
const warm: Record<string, number> = {};
for (let i = 0; i < 2000; i++) {
  write(warm, "k" + (i % 5), i);
  total += read(warm, "k" + (i % 5));
}
console.log("2000 honest rounds: " + total);

const keys = ["b", "2", "a", "1", "01", "1.0", "-1", "-0", "0", "1.5", "4294967294", "4294967295", "4294967296", "10", "9", "1e3", "+1", " 1", "", "NaN"];
const record: Record<string, number> = {};
keys.forEach((key, position) => write(record, key, position));
console.log("the order of the keys: " + state(record));
attempt("each is read back", () => keys.map(key => read(record, key)));
attempt("for in", () => {
  const seen: string[] = [];
  for (const key in record) seen.push(key);
  return seen.join("|");
});
attempt("entries", () => Object.entries(record).map(([key, value]) => key + "=" + value).join("|"));
attempt("a spread keeps the order", () => state({ ...record }));
attempt("by numbers", () => {
  const byNumber: Record<number, number> = record;
  return [byNumber[1], byNumber[1.0], byNumber[-0], byNumber[0], byNumber[-1], byNumber[1.5], byNumber[1e3], byNumber[4294967295], byNumber[NaN], byNumber[10]];
});

const literal = { b: 1, 2: 2, a: 3, 1: 4, "01": 5, "-1": 6, 1.5: 7, 1e3: 8, 0x10: 9, 1_0: 10 };
console.log("a literal: " + state(literal));
attempt("its members", () => [literal[1], literal["1"], literal["01"], literal[2], literal["-1"], literal[1.5], literal["1.5"], literal[1000], literal["1000"], literal[16], literal[10]]);

const one: number = 1;
const oneAsText: string = "1";
const minusZero: number = -0;
const zero: number = 0;
const computed: Record<string, number> = { [one]: 1, [oneAsText]: 2, ["01"]: 4, [minusZero]: 5, ["-0"]: 6, [zero]: 7 };
console.log("computed names collide: " + state(computed));

attempt("deleted and stored again", () => {
  const r: Record<string, number> = { a: 1, 5: 2, b: 3, 3: 4 };
  delete r["5"];
  delete r.a;
  r.a = 5;
  r[5] = 6;
  return state(r);
});
attempt("many index keys out of order", () => {
  const r: Record<string, number> = {};
  for (const key of [1000, 5, 70000, 0, 3, 2 ** 31, 2 ** 32 - 2, 2 ** 32 - 1, 7]) r[key] = key;
  return state(r);
});

class Shelf {
  [slot: string]: number;
  z = 1;
  a = 2;
}
const shelf = new Shelf();
shelf["1"] = 3;
shelf["01"] = 4;
shelf["0"] = 5;
console.log("a class with an index signature: " + state(shelf) + " " + (shelf.z + shelf.a + shelf[1] + shelf["01"]) + " " + typeof shelf.missing);

export {};
