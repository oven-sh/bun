// `bun <file>` makes one more module of the file for each query: it runs again and has objects of its own. "?x=1" and "x=1" are one query, and an empty one is none.
const plain = import.meta.glob("./dir/a.ts");
const first = import.meta.glob("./dir/a.ts", { query: "?x=1" });
const again = import.meta.glob("./dir/a.ts", { query: "x=1" });
const other = import.meta.glob("./dir/a.ts", { query: { y: 2 } });
const empty = import.meta.glob("./dir/a.ts", { query: "" });
const eager = import.meta.glob("./dir/a.ts", { query: "?z=3", eager: true });
console.log(Object.keys(first), Object.keys(eager));
const load = async (found: Record<string, unknown>) => (await (found["./dir/a.ts"] as () => Promise<{ made: object }>)()).made;
const [p, f, g, o, e] = [await load(plain), await load(first), await load(again), await load(other), await load(empty)];
console.log(p === f, f === g, f === o, p === e, (eager["./dir/a.ts"] as { made: object }).made === p);
const direct = await import("./dir/a.ts?x=1");
console.log(direct.made === f, (await import("./dir/a.ts")).made === p);
