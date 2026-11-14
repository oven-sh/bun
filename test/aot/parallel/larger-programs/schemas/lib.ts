// Schemas made of values: types that follow from them, checks with paths, transforms, unions by a field, recursion, defaults, errors as a tree, JSON Schema out and in, samples
export type Issue = {
  path: (string | number)[];
  message: string;
  code: string
};
export type Result<T> = {
  ok: true;
  value: T
} | {
  ok: false;
  issues: Issue[]
};
export type Infer<S> = S extends Schema<infer T> ? T : never;
export class Invalid extends Error {
  constructor(readonly issues: readonly Issue[]) {
    super(issues.map(i => `${formatPath(i.path)}: ${i.message}`).join("; "));
    this.name = "Invalid";
  }
}
export function formatPath(path: readonly (string | number)[]): string {
  return path.reduce<string>((all,
    p) => all + (typeof p === "number" ? `[${p}]` : all ? "." + p : p), "") || "value";
}
export class Report {
  readonly issues: Issue[] = [];
  #path: (string | number)[] = [];
  visited = 0;
  constructor(readonly limit = 20) {
  }
  at<T>(key: string | number, work: () => T): T {
    this.#path.push(key);
    try {
      return work();
  } finally {
      this.#path.pop();
    }
  }
  add(code: string, message: string) {
    if (this.issues.length < this.limit) this.issues.push({ path: [...this.#path], code,
      message });
  }
  fork(): Report {
    const r = new Report(this.limit);
    r.#path = [...this.#path];
    return r;
  }
  get depth() {
    return this.#path.length;
  }
}
export abstract class Schema<T> {
  protected notes: {
    title?: string;
    about?: string
} = {
};
  abstract readonly kind: string;
  abstract check(v: unknown, r: Report): T;
  abstract json(refs: Map<Schema<any>, string>): Record<string, unknown>;
  abstract sample(n: number): unknown;
  parse(v: unknown): T {
    const s = this.safe(v);
    if (!s.ok) throw new Invalid(s.issues);
    return s.value;
  }
  safe(v: unknown): Result<T> {
    const r = new Report();
    const value = this.check(v, r);
    return r.issues.length ? {
      ok: false, issues: r.issues
  } : {
      ok: true, value
  };
  }
  is(v: unknown): v is T {
    return this.safe(v).ok;
  }
  title(title: string): this {
    const c = this.clone();
    c.notes = {
      ...this.notes, title
  };
    return c;
  }
  protected clone(): this {
    return Object.assign(Object.create(Object.getPrototypeOf(this)), this);
  }
  optional(): Schema<T | undefined> {
    return new Optional(this);
  }
  nullable(): Schema<T | null> {
    return new Nullable(this);
  }
  default(value: T | (() => T)): Schema<T> {
    return new Default(this, value);
  }
  refine(test: (v: T) => boolean, message: string): Schema<T> {
    return new Refined(this, test, message);
  }
  map<U>(f: (v: T) => U, name = "mapped"): Schema<U> {
    return new Mapped(this, f, name);
  }
  or<U>(o: Schema<U>): Schema<T | U> {
    return new Union<T | U>([this, o]);
  }
  static wrong(r: Report, want: string, v: unknown) {
    r.add("type",
      `expected ${want}, got ${v === null ? "null" : Array.isArray(v) ? "list" : typeof v}`);
  }
}
export class Text extends Schema<string> {
  readonly kind = "text";
  #min = 0;
  #max = Infinity;
  #pattern: RegExp | null = null;
  #trim = false;
  min(n: number) {
    const c = this.copy();
    c.#min = n;
    return c;
  }
  max(n: number) {
    const c = this.copy();
    c.#max = n;
    return c;
  }
  match(p: RegExp) {
    const c = this.copy();
    c.#pattern = p;
    return c;
  }
  trim() {
    const c = this.copy();
    c.#trim = true;
    return c;
  }
  copy(): Text {
    const c = new Text();
    c.#min = this.#min;
    c.#max = this.#max;
    c.#pattern = this.#pattern;
    c.#trim = this.#trim;
    c.notes = this.notes;
    return c;
  }
  protected clone(): this {
    return this.copy() as this;
  }
  check(v: unknown, r: Report): string {
    r.visited++;
    if (typeof v !== "string") {
      Schema.wrong(r, "text", v);
      return "";
    }
    const s = this.#trim ? v.trim() : v;
    if (s.length < this.#min) r.add("min", `at least ${this.#min} characters`);
    if (s.length > this.#max) r.add("max", `at most ${this.#max} characters`);
    if (this.#pattern && !this.#pattern.test(s)) r.add("match",
      `must match ${this.#pattern.source}`);
    return s;
  }
  json() {
    return {
      type: "string", ...(this.#min ? { minLength: this.#min } : {}),
        ...(this.#max < Infinity ? { maxLength: this.#max } : {}),
        ...(this.#pattern ? { pattern: this.#pattern.source } : {}), ...this.notes
  };
  }
  sample(n: number) {
    const base = "text" + n;
    return base.padEnd(this.#min, "x").slice(0, this.#max);
  }
}
export class Num extends Schema<number> {
  readonly kind = "number";
  constructor(private readonly low = -Infinity, private readonly high = Infinity,
    private readonly whole = false) {
    super();
  }
  between(a: number, b: number) {
    return new Num(a, b, this.whole);
  }
  int() {
    return new Num(this.low, this.high, true);
  }
  check(v: unknown, r: Report): number {
    r.visited++;
    if (typeof v !== "number" || Number.isNaN(v)) {
      Schema.wrong(r, "number", v);
      return 0;
    }
    if (this.whole && !Number.isInteger(v)) r.add("int", "must be whole");
    if (v < this.low || v > this.high) r.add("range", `must be in ${this.low}..${this.high}`);
    return v;
  }
  json() {
    return {
      type: this.whole ? "integer" : "number",
        ...(this.low > -Infinity ? { minimum: this.low } : {}),
        ...(this.high < Infinity ? { maximum: this.high } : {})
  };
  }
  sample(n: number) {
    const low = this.low === -Infinity ? 0 : this.low,
      high = this.high === Infinity ? low + 100 : this.high;
    const v = low + (n * 7) % (high - low + 1);
    return this.whole ? Math.floor(v) : v;
  }
}
export class Bool extends Schema<boolean> {
  readonly kind = "bool";
  check(v: unknown, r: Report): boolean {
    r.visited++;
    if (typeof v !== "boolean") Schema.wrong(r, "bool", v);
    return v === true;
  }
  json() {
    return {
      type: "boolean"
  };
  }
  sample(n: number) {
    return n % 2 === 0;
  }
}
export class Literal<L extends string | number | boolean | null> extends Schema<L> {
  readonly kind = "literal";
  readonly values: readonly L[];
  constructor(...values: L[]) {
    super();
    this.values = values;
  }
  check(v: unknown, r: Report): L {
    r.visited++;
    if (!this.values.includes(v as L)) r.add("literal",
      `expected ${this.values.map(x => JSON.stringify(x)).join(" or ")}`);
    return v as L;
  }
  json() {
    return this.values.length === 1 ? {
      const: this.values[0]
  } : {
      enum: this.values
  };
  }
  sample(n: number) {
    return this.values[n % this.values.length];
  }
}
export class List<T> extends Schema<T[]> {
  readonly kind = "list";
  constructor(readonly item: Schema<T>, readonly min = 0, readonly max = Infinity,
    readonly distinct = false) {
    super();
  }
  length(min: number, max = Infinity) {
    return new List(this.item, min, max, this.distinct);
  }
  unique() {
    return new List(this.item, this.min, this.max, true);
  }
  check(v: unknown, r: Report): T[] {
    r.visited++;
    if (!Array.isArray(v)) {
      Schema.wrong(r, "list", v);
      return [];
    }
    if (v.length < this.min || v.length > this.max) r.add("length",
      `needs ${this.min}..${this.max} items`);
    const out: T[] = [];
    for (let i = 0; i < v.length; i++) out.push(r.at(i, () => this.item.check(v[i], r)));
    if (this.distinct &&
      new Set(out.map(x => JSON.stringify(x))).size !== out.length) r.add("unique",
      "items must differ");
    return out;
  }
  json(refs: Map<Schema<any>, string>) {
    return {
      type: "array", items: this.item.json(refs), ...(this.min ? { minItems: this.min } : {}),
        ...(this.distinct ? { uniqueItems: true } : {})
  };
  }
  sample(n: number) {
    return Array.from({ length: Math.max(this.min, n % 4) }, (_,
      i) => this.item.sample(n + i * 3 + 1));
  }
}
export type Shape = Record<string, Schema<any>>;
export type Fields<S extends Shape> = {
  [K in keyof S]: Infer<S[K]>
};
export class Obj<S extends Shape> extends Schema<Fields<S>> {
  readonly kind = "object";
  constructor(readonly shape: S, readonly extra: "strip" | "keep" | "refuse" = "strip") {
    super();
  }
  strict() {
    return new Obj(this.shape, "refuse");
  }
  loose() {
    return new Obj(this.shape, "keep");
  }
  extend<U extends Shape>(more: U): Obj<S & U> {
    return new Obj({ ...this.shape, ...more }, this.extra);
  }
  pick<K extends keyof S>(...keys: K[]): Obj<Pick<S, K>> {
    const out = {
  } as Pick<S, K>;
    for (const k of keys) out[k] = this.shape[k];
    return new Obj(out, this.extra);
  }
  partial(): Obj<{
    [K in keyof S]: Schema<Infer<S[K]> | undefined>
  }
  > {
    const out: any = {
  };
    for (const k in this.shape) out[k] = this.shape[k].optional();
    return new Obj(out, this.extra);
  }
  check(v: unknown, r: Report): Fields<S> {
    r.visited++;
    const out: Record<string, unknown> = {
  };
    if (v === null || typeof v !== "object" || Array.isArray(v)) {
      Schema.wrong(r, "object", v);
      return out as Fields<S>;
    }
    for (const k in this.shape) {
      const value = r.at(k, () => this.shape[k].check((v as Record<string, unknown>)[k], r));
      if (value !== undefined || k in v) out[k] = value;
    }
    if (this.extra !== "strip") for (const k of Object.keys(v)) if (!Object.prototype.hasOwnProperty.call(this.shape,
      k)) {
      if (this.extra === "refuse") r.at(k, () => r.add("unknown", "is not known"));
      else out[k] = (v as Record<string, unknown>)[k];
    }
    return out as Fields<S>;
  }
  json(refs: Map<Schema<any>, string>): Record<string, unknown> {
    const properties: Record<string, unknown> = {
  }, required: string[] = [];
    for (const k in this.shape) {
      properties[k] = this.shape[k].json(refs);
      if (!(this.shape[k] instanceof Optional) &&
        !(this.shape[k] instanceof Default)) required.push(k);
    }
    return {
      type: "object", properties, required,
        ...(this.extra === "refuse" ? { additionalProperties: false } : {}), ...this.notes
  };
  }
  sample(n: number) {
    const out: Record<string, unknown> = {
  };
    let i = 0;
    for (const k in this.shape) {
      const v = this.shape[k].sample(n + ++i);
      if (v !== undefined) out[k] = v;
    }
    return out;
  }
}
export class Optional<T> extends Schema<T | undefined> {
  readonly kind = "optional";
  constructor(readonly inner: Schema<T>) {
    super();
  }
  check(v: unknown, r: Report) {
    return v === undefined ? undefined : this.inner.check(v, r);
  }
  json(refs: Map<Schema<any>, string>) {
    return this.inner.json(refs);
  }
  sample(n: number) {
    return n % 3 ? this.inner.sample(n) : undefined;
  }
}
export class Nullable<T> extends Schema<T | null> {
  readonly kind = "nullable";
  constructor(readonly inner: Schema<T>) {
    super();
  }
  check(v: unknown, r: Report) {
    return v === null ? null : this.inner.check(v, r);
  }
  json(refs: Map<Schema<any>, string>) {
    return {
      anyOf: [this.inner.json(refs), { type: "null" }]
  };
  }
  sample(n: number) {
    return n % 2 ? this.inner.sample(n) : null;
  }
}
export class Default<T> extends Schema<T> {
  readonly kind = "default";
  constructor(readonly inner: Schema<T>, readonly value: T | (() => T)) {
    super();
  }
  check(v: unknown, r: Report): T {
    return v === undefined ? (typeof this.value === "function" ? (this.value as () => T)() : this.value) : this.inner.check(v,
      r);
  }
  json(refs: Map<Schema<any>, string>) {
    return {
      ...this.inner.json(refs),
        default: typeof this.value === "function" ? (this.value as () => T)() : this.value
  };
  }
  sample(n: number) {
    return n % 2 ? this.inner.sample(n) : undefined;
  }
}
export class Refined<T> extends Schema<T> {
  readonly kind = "refined";
  constructor(readonly inner: Schema<T>, readonly test: (v: T) => boolean,
    readonly message: string) {
    super();
  }
  check(v: unknown, r: Report): T {
    const before = r.issues.length, out = this.inner.check(v, r);
    if (r.issues.length === before && !this.test(out)) r.add("refine", this.message);
    return out;
  }
  json(refs: Map<Schema<any>, string>) {
    return this.inner.json(refs);
  }
  sample(n: number) {
    for (let i = 0; i < 50; i++) {
      const s = this.inner.sample(n + i);
      const v = this.inner.safe(s);
      if (v.ok && this.test(v.value)) return s;
    }
    return this.inner.sample(n);
  }
}
export class Mapped<T, U> extends Schema<U> {
  readonly kind = "mapped";
  constructor(readonly inner: Schema<T>, readonly f: (v: T) => U, readonly name: string) {
    super();
  }
  check(v: unknown, r: Report): U {
    const before = r.issues.length, out = this.inner.check(v, r);
    if (r.issues.length > before) return undefined as U;
    try {
      return this.f(out);
  } catch (e) {
      r.add("map", `${this.name}: ${(e as Error).message}`);
      return undefined as U;
    }
  }
  json(refs: Map<Schema<any>, string>) {
    return this.inner.json(refs);
  }
  sample(n: number) {
    return this.inner.sample(n);
  }
}
export class Union<T> extends Schema<T> {
  readonly kind = "union";
  constructor(readonly options: readonly Schema<any>[]) {
    super();
  }
  check(v: unknown, r: Report): T {
    r.visited++;
    let best: Report | null = null;
    for (const o of this.options) {
      const f = r.fork(), out = o.check(v, f);
      if (!f.issues.length) return out as T;
      if (!best || f.issues.length < best.issues.length) best = f;
    }
    r.add("union", "fits no option: " + best!.issues.map(i => i.message).slice(0,
      2).join(", "));
    return v as T;
  }
  json(refs: Map<Schema<any>, string>) {
    return {
      anyOf: this.options.map(o => o.json(refs))
  };
  }
  sample(n: number) {
    return this.options[n % this.options.length].sample(n);
  }
}
export class Tagged<K extends string, T extends Record<string, Obj<any>>> extends Schema<{
  [P in keyof T]: Infer<T[P]> & {
    [X in K]: P
  }
}[keyof T]> {
  readonly kind = "tagged";
  constructor(readonly tag: K, readonly options: T) {
    super();
  }
  check(v: unknown, r: Report): any {
    r.visited++;
    const name = (v as any)?.[this.tag];
    const o = typeof name === "string" && Object.prototype.hasOwnProperty.call(this.options,
      name) ? this.options[name] : undefined;
    if (!o) {
      r.at(this.tag, () => r.add("tag", `expected ${Object.keys(this.options).join(" or ")}`));
      return v;
    }
    return {
      [this.tag]: name, ...o.check(v, r)
  };
  }
  json(refs: Map<Schema<any>, string>) {
    return {
      oneOf: Object.entries(this.options).map(([name, o]) => {
        const j = o.json(refs) as any;
        return {
          ...j, properties: {
            [this.tag]: {
              const: name
          }, ...j.properties
          }
      };
    })
  };
  }
  sample(n: number) {
    const names = Object.keys(this.options), name = names[n % names.length];
    return {
      [this.tag]: name, ...this.options[name].sample(n)
  };
  }
}
export class Lazy<T> extends Schema<T> {
  readonly kind = "lazy";
  #made: Schema<T> | null = null;
  constructor(readonly name: string, readonly make: () => Schema<T>) {
    super();
  }
  get inner() {
    return (this.#made ??= this.make());
  }
  check(v: unknown, r: Report): T {
    if (r.depth > 40) {
      r.add("depth", "too deep");
      return v as T;
    }
    return this.inner.check(v, r);
  }
  json(refs: Map<Schema<any>, string>): Record<string, unknown> {
    if (!refs.has(this)) {
      refs.set(this, "#/$defs/" + this.name);
    }
    return {
      $ref: refs.get(this)
  };
  }
  sample(n: number) {
    return n % 5 < 3 ? null : this.inner.sample(n >> 1);
  }
}
export namespace s {
  export const text = () => new Text();
  export const num = () => new Num();
  export const bool = () => new Bool();
  export const lit = <L extends string | number | boolean | null>(...v: L[]) => new Literal(...v);
  export const list = <T>(item: Schema<T>) => new List(item);
  export const obj = <S extends Shape>(shape: S) => new Obj(shape);
  export const tagged = <K extends string, T extends Record<string, Obj<any>>>(tag: K,
    options: T) => new Tagged(tag, options);
  export const lazy = <T>(name: string, make: () => Schema<T>) => new Lazy(name, make);
  export const date = () => text().match(/^\d{4}-\d\d-\d\d$/).map(t => {
    const d = new Date(t + "T00:00:00Z");
    if (Number.isNaN(d.getTime())) throw new RangeError("no such day");
    return d;
}, "date");
}
