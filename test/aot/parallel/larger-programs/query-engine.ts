// Typed tables with a fluent query: filters, joins, groups, windows, indexes, a planner that chooses, and explanations
type Row = Record<string, unknown>;
type Key<T> = Extract<keyof T, string>;
type Pred<T> = (row: T) => boolean;
interface Index<T> {
  readonly column: Key<T>;
  find(value: unknown): T[];
  add(row: T): void;
  readonly size: number
}
class HashIndex<T> implements Index<T> {
  readonly #rows = new Map<unknown, T[]>();
  size = 0;
  constructor(readonly column: Key<T>) {
  }
  add(row: T) {
    const k = row[this.column];
    const list = this.#rows.get(k);
    if (list) list.push(row);
    else this.#rows.set(k, [row]);
    this.size++;
  }
  find(value: unknown) {
    return this.#rows.get(value) ?? [];
  }
}
class SortedIndex<T> implements Index<T> {
  readonly #rows: T[] = [];
  constructor(readonly column: Key<T>) {
  }
  get size() {
    return this.#rows.length;
  }
  #at(value: any) {
    let low = 0, high = this.#rows.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if ((this.#rows[mid][this.column] as any) < value) low = mid + 1;
      else high = mid;
    }
    return low;
  }
  add(row: T) {
    this.#rows.splice(this.#at(row[this.column]), 0, row);
  }
  find(value: unknown) {
    const out: T[] = [];
    for (let i = this.#at(value); i < this.#rows.length &&
      this.#rows[i][this.column] === value; i++) out.push(this.#rows[i]);
    return out;
  }
  between(low: any, high: any): T[] {
    return this.#rows.slice(this.#at(low), this.#at(high));
  }
}
class Table<T extends Row> implements Iterable<T> {
  readonly #rows: T[] = [];
  readonly #indexes: Index<T>[] = [];
  reads = 0;
  constructor(readonly name: string, rows: Iterable<T> = []) {
    for (const r of rows) this.insert(r);
  }
  insert(row: T): this {
    this.#rows.push(row);
    for (const i of this.#indexes) i.add(row);
    return this;
  }
  index(column: Key<T>, kind: "hash" | "sorted" = "hash"): this {
    const made: Index<T> = kind === "hash" ? new HashIndex<T>(column) : new SortedIndex<T>(column);
    for (const r of this.#rows) made.add(r);
    this.#indexes.push(made);
    return this;
  }
  indexOn(column: string): Index<T> | undefined {
    return this.#indexes.find(i => i.column === column);
  }
  get size() {
    return this.#rows.length;
  }
  *[Symbol.iterator](): Generator<T> {
    for (const r of this.#rows) {
      this.reads++;
      yield r;
    }
} from(): Query<T> {
    return new Query<T>(Plan.scan(this), this);
  }
}
type Step = {
  op: "scan";
  table: string;
  rows: number
} | {
  op: "seek";
  table: string;
  column: string;
  value: unknown
} | {
  op: "range";
  table: string;
  column: string
} | {
  op: "filter";
  label: string
} | {
  op: "join";
  kind: "hash" | "loop" | "left";
  with: string
} | {
  op: "group";
  by: string[]
} | {
  op: "sort";
  by: string[]
} | {
  op: "limit";
  n: number;
  skip: number
} | {
  op: "project";
  columns: string[]
} | {
  op: "distinct"
} | {
  op: "window";
  column: string
};
class Plan<T> {
  constructor(readonly steps: readonly Step[], readonly run: () => Iterable<T>) {
  }
  static scan<T extends Row>(t: Table<T>): Plan<T> {
    return new Plan<T>([{ op: "scan", table: t.name, rows: t.size }], () => t);
  }
  then<U>(step: Step, f: (rows: Iterable<T>) => Iterable<U>): Plan<U> {
    return new Plan<U>([...this.steps, step], () => f(this.run()));
  }
  explain(): string {
    return this.steps.map(s => {
      switch (s.op) {
        case "scan": return `scan ${s.table}(${s.rows})`;
        case "seek": return `seek ${s.table}.${s.column}=${String(s.value)}`;
        case "range": return `range ${s.table}.${s.column}`;
        case "filter": return "filter " + s.label;
        case "join": return `${s.kind} join ${s.with}`;
        case "group": return "group by " + s.by.join();
        case "sort": return "sort " + s.by.join();
        case "limit": return `limit ${s.n}+${s.skip}`;
        case "project": return "project " + s.columns.join();
        case "window": return "window " + s.column;
        default: return s.op;
      }
  }).join(" > ");
  }
}
namespace Aggregate {
  export type Fn<T> = {
    start: () => any;
    step: (a: any, row: T) => any;
    end?: (a: any) => unknown
};
  export const count = <T>(): Fn<T> => ({ start: () => 0, step: a => a + 1 });
  export const sum = <T>(f: (row: T) => number): Fn<T> => ({ start: () => 0, step: (a,
    r) => a + f(r) });
  export const avg = <T>(f: (row: T) => number): Fn<T> => ({ start: () => ({ n: 0, s: 0 }),
    step: (a, r) => ({ n: a.n + 1, s: a.s + f(r) }), end: a => (a.n ? a.s / a.n : null) });
  export const max = <T>(f: (row: T) => number): Fn<T> => ({ start: () => -Infinity, step: (a,
    r) => Math.max(a, f(r)) });
  export const list = <T>(f: (row: T) => unknown): Fn<T> => ({ start: () => [], step: (a,
    r) => (a.push(f(r)), a), end: a => a.join("+") });
}
class Query<T extends Row> {
  constructor(private readonly plan: Plan<T>, private readonly base: Table<any> | null = null) {
  }
  #next<U extends Row>(step: Step, f: (rows: Iterable<T>) => Iterable<U>) {
    return new Query<U>(this.plan.then(step, f));
  }
  where<K extends Key<T>>(column: K, value: T[K]): Query<T>;
  where(label: string, test: Pred<T>): Query<T>;
  where(a: string, b: unknown): Query<T> {
    if (typeof b === "function") return this.#next({ op: "filter", label: a },
      function* (rows) {
      for (const r of rows) if ((b as Pred<T>)(r)) yield r;
  });
    const index = this.base?.indexOn(a);
    if (index && this.plan.steps.length === 1) return new Query<T>(new Plan<T>([{ op: "seek",
      table: this.base!.name, column: a, value: b }], () => index.find(b) as T[]));
    return this.#next({ op: "filter", label: a + "=" + String(b) }, function* (rows) {
      for (const r of rows) if (r[a] === b) yield r;
  });
  }
  between<K extends Key<T>>(column: K, low: T[K], high: T[K]): Query<T> {
    const index = this.base?.indexOn(column);
    if (index instanceof SortedIndex &&
      this.plan.steps.length === 1) return new Query<T>(new Plan<T>([{ op: "range",
      table: this.base!.name, column }], () => index.between(low, high) as T[]));
    return this.#next({ op: "filter", label: `${column} in range` }, function* (rows) {
      for (const r of rows) if (r[column] >= low && r[column] < high) yield r;
  });
  }
  join<U extends Row, R extends Row>(other: Table<U>, left: Key<T>, right: Key<U>, make: (a: T,
    b: U) => R, kind: "inner" | "left" = "inner"): Query<R> {
    const index = other.indexOn(right) ?? (other.size > 8 ? new HashIndex<U>(right) : undefined);
    if (index && index.size === 0) for (const r of other) index.add(r);
    const find = index ? (v: unknown) => index.find(v) : (v: unknown) => [...other].filter(r => r[right] === v);
    return this.#next<R>({ op: "join",
      kind: kind === "left" ? "left" : index ? "hash" : "loop", with: other.name },
      function* (rows) {
      for (const a of rows) {
        let any = false;
        for (const b of find(a[left])) {
          any = true;
          yield make(a, b);
        }
        if (!any && kind === "left") yield make(a, {} as U);
      }
  });
  }
  group<K extends Key<T>, A extends Record<string, Aggregate.Fn<T>>>(by: K[],
    what: A): Query<Pick<T, K> & {
    [P in keyof A]: any
  }
  > {
    return this.#next({ op: "group", by }, function* (rows) {
      const groups = new Map<string, {
        first: T;
        state: any[]
      }
      >();
      const entries = Object.entries(what);
      for (const r of rows) {
        const key = by.map(k => String(r[k])).join("\u0000");
        let g = groups.get(key);
        if (!g) groups.set(key, (g = { first: r, state: entries.map(([, f]) => f.start()) }));
        for (let i = 0; i < entries.length; i++) g.state[i] = entries[i][1].step(g.state[i], r);
      }
      for (const { first, state } of groups.values()) {
        const out: any = {
      };
        for (const k of by) out[k] = first[k];
        entries.forEach(([name, f], i) => {
          out[name] = f.end ? f.end(state[i]) : state[i];
      });
        yield out;
      }
  });
  }
  sort(...by: (Key<T> | `-${Key<T>}`)[]): Query<T> {
    return this.#next({ op: "sort", by }, rows => [...rows].sort((a, b) => {
      for (const k of by) {
        const down = k[0] === "-", name = down ? k.slice(1) : k;
        const x = a[name] as any, y = b[name] as any;
        if (x !== y) return (x < y ? -1 : 1) * (down ? -1 : 1);
      }
      return 0;
  }));
  }
  limit(n: number, skip = 0): Query<T> {
    return this.#next({ op: "limit", n, skip }, function* (rows) {
      let i = 0;
      for (const r of rows) {
        if (i++ < skip) continue;
        if (i > n + skip) return;
        yield r;
      }
  });
  }
  select<R extends Row>(columns: string[], f: (row: T) => R): Query<R> {
    return this.#next<R>({ op: "project", columns }, function* (rows) {
      for (const r of rows) yield f(r);
  });
  }
  distinct(): Query<T> {
    return this.#next({ op: "distinct" }, function* (rows) {
      const seen = new Set<string>();
      for (const r of rows) {
        const k = JSON.stringify(r);
        if (!seen.has(k)) {
          seen.add(k);
          yield r;
        }
      }
  });
  }
  window<N extends string>(name: N, size: number, f: (rows: T[]) => unknown): Query<T & {
    [P in N]: unknown
  }
  > {
    return this.#next({ op: "window", column: name }, function* (rows) {
      const last: T[] = [];
      for (const r of rows) {
        last.push(r);
        if (last.length > size) last.shift();
        yield {
          ...r, [name]: f(last)
      } as any;
      }
  });
  }
  toArray(): T[] {
    return [...this.plan.run()];
  }
  first(): T | undefined {
    for (const r of this.plan.run()) return r;
  }
  explain() {
    return this.plan.explain();
  }
}
interface Person extends Row {
  id: number;
  name: string;
  team: number;
  pay: number;
  born: number
}
interface Team extends Row {
  id: number;
  title: string;
  floor: number
}
interface Sale extends Row {
  person: number;
  amount: number;
  month: number
}
const people = new Table<Person>("people", Array.from({ length: 1200 }, (_, i) => ({ id: i,
  name: "p" + ((i * 7919) % 613), team: i % 13, pay: ((i * 104729) % 9001) / 10,
  born: 1950 + (i * 31) % 55 }))).index("id").index("born", "sorted");
const teams = new Table<Team>("teams", Array.from({ length: 12 }, (_, id) => ({ id,
  title: "team " + String.fromCharCode(65 + id), floor: id % 4 })));
const sales = new Table<Sale>("sales", Array.from({ length: 5000 }, (_,
  i) => ({ person: (i * 17) % 1300, amount: ((i * 263) % 997) / 4,
  month: 1 + (i % 12) }))).index("person");
const show = (rows: Row[]) => rows.map(r => Object.values(r).map(v => (typeof v === "number" ? +v.toFixed(3) : v)).join(" ")).join("; ");
const {
  count, sum, avg, max, list
} = Aggregate;
const queries: [string, () => Query<any>][] = [["seek", () => people.from().where("id", 77)],
  ["range", () => people.from().between("born", 1980, 1982).sort("-pay", "id").limit(3)],
  ["join", () => people.from().where("rich", (p: Person) => p.pay > 880).join(teams, "team", "id", (p,
  t) => ({ name: p.name, pay: p.pay, title: t.title }), "left").sort("title",
  "name").limit(6)], ["groups", () => people.from().join(teams, "team", "id", (p,
  t) => ({ ...p, floor: t.floor })).group(["floor"], { n: count(), pay: sum(p => p.pay),
  mean: avg(p => p.pay), top: max(p => p.pay) }).sort("floor")], ["sales",
  () => sales.from().join(people, "person", "id", (s, p) => ({ team: p.team, month: s.month,
  amount: s.amount })).group(["team", "month"], { total: sum(r => r.amount),
  n: count() }).sort("-total", "team", "month").limit(5, 2)], ["window",
  () => sales.from().where("person", 34).sort("month", "amount").window("running", 3,
  rows => rows.reduce((a, r) => a + r.amount, 0)).select(["month", "running"],
  r => ({ month: r.month, running: r.running }))], ["distinct",
  () => people.from().select(["born"],
  p => ({ decade: Math.floor(p.born / 10) * 10 })).distinct().sort("decade")], ["lists",
  () => people.from().where("few", (p: Person) => p.id < 40).group(["team"],
  { ids: list(p => p.id) }).sort("team").limit(4)]];
for (let round = 0; round < 25; round++) for (const [name, make] of queries) {
  const q = make(), rows = q.toArray();
  if (round === 0) {
    console.log(name, "|", q.explain());
    console.log(" ", rows.length, show(rows.slice(0, 6)));
  }
  if (round % 5 === 4 && name === "range") people.insert({ id: 5000 + round,
    name: "new" + round, team: 3, pay: 999 + round, born: 1981 });
}
console.log(people.reads, teams.reads, sales.reads, people.size, people.from().where("name",
  "new24").first()?.pay, people.from().where("id", 5009).first()?.name,
  people.from().where("id", -1).first());
