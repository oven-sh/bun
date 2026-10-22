// Tables derived from other tables, where something changes a source after the start and before the first read of what was derived.
const log: string[] = [];
const SOURCE = ["a", "b", "c"];
const DERIVED = SOURCE.map(s => s + "!");
const JOINED = SOURCE.join(",");
const AS_SET = new Set(SOURCE);
const COPY = [...SOURCE, "z"];
const SLICED = SOURCE.slice(1);
const HAS_B = SOURCE.includes("b");
const LENGTH = { n: SOURCE.length };
const PICKED = ["zero", "one", "two", "three", "four"][SOURCE.length];
const LAST = [SOURCE.at(-1), SOURCE[SOURCE.length - 1], SOURCE.indexOf("c"), SOURCE.lastIndexOf("a")];
const sizes = new Map([["k", 1]]); const members = new Set(["m"]);
const SIZES = [sizes.size, members.size, sizes.has("l"), members.has("n"), sizes.get("l")];
function grow() { SOURCE.push("d"); SOURCE[0] = "A"; sizes.set("l", 2); members.add("n"); }
grow();
log.push(JSON.stringify([DERIVED, JOINED, [...AS_SET], COPY, SLICED, HAS_B, LENGTH, PICKED, LAST, SIZES]));

const RECORDS = [{ name: "x", n: 1 }, { name: "y", n: 2 }];
const NAMES = RECORDS.map(r => r.name);
const TOTAL = RECORDS.reduce((sum, r) => sum + r.n, 0);
const BY_NAME = new Map(RECORDS.map(r => [r.name, r] as const));
function rename() { RECORDS[0].name = "renamed"; RECORDS[1].n = 40; }
rename();
log.push(JSON.stringify([NAMES, TOTAL, [...BY_NAME.keys()], BY_NAME.get("x")]));

const OPTIONS = { depth: 1, tags: ["t"] };
const MERGED = { ...OPTIONS, extra: true };
const KEYS = Object.keys(OPTIONS);
const VALUES = Object.values(OPTIONS);
const ENTRIES = Object.entries(OPTIONS);
function reconfigure() { OPTIONS.depth = 9; (OPTIONS as any).added = 1; OPTIONS.tags.push("u"); }
reconfigure();
log.push(JSON.stringify([MERGED, KEYS, VALUES, ENTRIES]));

// The one who changes it gets it through what was derived.
const INNER = [1, 2, 3];
const HOLDER = { list: INNER };
const DOUBLED = INNER.map(n => n * 2);
function throughHolder(h: { list: number[] }) { h.list.push(4); }
throughHolder(HOLDER);
log.push(JSON.stringify([DOUBLED, HOLDER]));

// Changed in a later turn, read after that.
const LATE = ["p", "q"];
const LATE_UPPER = LATE.map(s => s.toUpperCase());
setTimeout(() => { LATE.push("r"); }, 0);
setTimeout(() => { log.push(JSON.stringify([LATE_UPPER, LATE])); console.log(log.join("\n")); }, 5);
