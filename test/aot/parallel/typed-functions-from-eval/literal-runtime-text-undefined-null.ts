// Object literals in run-time text reach typed code with undefined, null, arrays of every storage and things like arrays in their fields: where the field's type has them, and where it has not.
interface Payload { value: unknown; issues: string[]; aborted?: boolean }
interface Row { name: string | null; count: number | undefined; next: Row | null; tags: string[] }
function describe(v: unknown): string { return v === undefined ? "undefined" : v === null ? "null" : typeof v === "object" ? JSON.stringify(v) : typeof v + ":" + String(v); }
function check(p: Payload): string { return describe(p.value) + "," + describe(p.issues) + "," + describe(p.aborted) + "," + ("value" in p) + "," + Object.keys(p).join("+") + "," + JSON.stringify(p); }
function read(r: Row): string { return describe(r.name) + "," + describe(r.count) + "," + describe(r.next) + "," + describe(r.tags) + "," + Object.keys(r).join("+") + "," + JSON.stringify(r); }
function own(i: number): string { return check({ value: i, issues: [] }) + read({ name: "n", count: i, next: null, tags: [] }); }
const payload = new Function("check", "v", "w", "return check({ value: v, issues: w })") as (c: typeof check, v: unknown, w: unknown) => string;
const whole = new Function("check", "v", "w", "a", "return check({ value: v, issues: w, aborted: a })") as (c: typeof check, v: unknown, w: unknown, a: unknown) => string;
const row = new Function("read", "a", "b", "c", "d", "return read({ name: a, count: b, next: c, tags: d })") as (r: typeof read, a: unknown, b: unknown, c: unknown, d: unknown) => string;
class List extends Array<string> {}
const values: unknown[] = [undefined, null, 0, 1.5, "text", true, false, [], ["a"], {}, { name: null, count: undefined, next: null, tags: [] }, Symbol.iterator, 10n, () => 1,
  [1], [1.5], [, "hole"], List.of("l"), new Uint8Array(2), Object.freeze(["f"]), new Proxy(["p"], {}), Object.assign(["e"], { extra: 1 }), { length: 1, 0: "like" }, new Set(["s"])];
const seen = new Map<string, number>();
function note(line: string) { seen.set(line, (seen.get(line) ?? 0) + 1); }
note(own(1));
for (let turn = 0; turn < 40; turn++) {
  for (const v of values) {
    const s = typeof v === "symbol" || typeof v === "bigint" || typeof v === "function";
    if (s) {
      note(new Function("p", "v", "const o = { value: v, issues: [] }; return typeof p(o)")((p: Payload) => p.value, v));
      continue;
    }
    note(payload(check, v, []));
    note(payload(check, 1, v));
    note(whole(check, v, [], v));
    note(row(read, v, 1, null, []));
    note(row(read, "n", v, null, []));
    note(row(read, "n", 1, v, []));
    note(row(read, "n", 1, null, v));
    note(row(read, v, v, v, v));
  }
}
for (const [line, count] of seen) console.log(count, line);
