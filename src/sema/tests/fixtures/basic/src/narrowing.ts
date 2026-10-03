type Circle = { kind: "circle"; radius: number };
type Square = { kind: "square"; side: number };
type Shape = Circle | Square;

export function viaSibling({ kind, ...rest }: Shape, other: Shape) {
  const { kind: k, ...more } = other;
  return [kind, rest, k, more] as const;
}

type Step = { done: false; value: string } | { done: true; value: undefined };
declare function next(): Step;

export function destructured() {
  const { done, value } = next();
  if (done) {
    return value;
  }
  return value.length;
}

export function destructuredParam({ done, value }: Step) {
  if (!done) {
    return value.toUpperCase();
  }
  return value;
}

type Pair = [tag: "n", payload: number] | [tag: "s", payload: string];
export function tuplePattern(pair: Pair) {
  const [tag, payload] = pair;
  if (tag === "n") {
    return payload.toFixed();
  }
  return payload.trim();
}

export function aliasOfProperty(shape: Shape) {
  const kind = shape.kind;
  if (kind === "circle") {
    return shape.radius;
  }
  return shape.side;
}

export function aliasByPattern(shape: Shape) {
  const { kind: which } = shape;
  switch (which) {
    case "circle":
      return shape.radius;
    case "square":
      return shape.side;
  }
}

export function storedCondition(shape: Shape, text: string | undefined) {
  const isCircle = shape.kind === "circle";
  const hasText = text !== undefined;
  const both = isCircle && hasText;
  if (both) {
    return shape.radius + text.length;
  }
  if (isCircle) {
    return shape.radius;
  }
  return hasText ? text : shape.side;
}

export function reassigned(shape: Shape) {
  const isCircle = shape.kind === "circle";
  shape = { kind: "square", side: 1 };
  if (isCircle) {
    return shape;
  }
  return shape.kind;
}

export function optionalChain(shape: Shape | undefined) {
  if (shape?.kind === "circle") {
    return shape.radius;
  }
  if (shape?.kind === "square") {
    return shape.side;
  }
  return shape;
}

export function keepsMissing(shape: Shape | undefined) {
  if (shape?.kind !== "circle") {
    return shape;
  }
  return shape;
}

declare function overloaded(x: string): string;
declare function overloaded(x: number): number;
declare function overloaded(x: "lit"): "lit";
export const lastOverload: ReturnType<typeof overloaded> = "lit";
export const specialised = overloaded("lit");

interface Emitter {
  on(event: string, listener: (value: unknown) => void): this;
}
interface Emitter {
  on(event: "close", listener: (code: number) => void): this;
  on(event: "data", listener: (chunk: string) => void): this;
}
export function listeners(emitter: Emitter) {
  emitter.on("close", code => code.toFixed());
  emitter.on("data", chunk => chunk.trim());
  emitter.on("other", value => value);
}

const brand: unique symbol = Symbol("brand");
const made = Symbol();
export interface Branded {
  readonly [brand]: "yes";
  [made]: number;
  plain: string;
}
export function symbols(b: Branded) {
  return [b[brand], b[made], b.plain] as const;
}

export function guards(list: (string | undefined)[]) {
  const a = list.filter(Boolean);
  const b = list.filter((x): x is string => x !== undefined);
  const c = list.filter(x => x !== undefined);
  return [a, b, c] as const;
}

declare function constParam<const T extends readonly unknown[]>(items: T): T;
export const kept = constParam(["a", 1, true]);

export type Flags = Readonly<Record<string, boolean>>;
export type MaybeFlags = Partial<Record<string, boolean>>;
export function records(f: Flags, m: MaybeFlags) {
  return [f.a, m.a, f, m] as const;
}

class Chain {
  more(): this {
    return this;
  }
  wrap(): Box<this> {
    return { value: this };
  }
}
interface Box<T> {
  value: T;
}
export const chained = new Chain().more().wrap().value;

declare function boxed<T>(value: T): Box<T>;
declare function boxed<T, U>(value: T, other: U): Box<[T, U]>;
export type BoxedString = ReturnType<typeof boxed<string>>;
export type BoxedPair = ReturnType<typeof boxed<string, number>>;
export function instantiated(a: BoxedString, b: BoxedPair, f: typeof boxed<boolean>) {
  return [a.value, b.value, f(true).value] as const;
}

export function conditionalSpread(flag: boolean, name: string | undefined) {
  return {
    always: 1,
    ...(flag ? { sometimes: "x" } : {}),
    ...(name && { name }),
    ...(flag ? { left: 1 } : { right: 2 }),
  };
}

type Copy<T> = { [K in keyof T]: T[K] };
type Named = { id: number; label?: string } & Record<string, unknown>;
export function keepsNames(c: Copy<Named>, r: Readonly<Named>, p: Partial<{ readonly a: 1; [k: number]: string }>) {
  return [c.id, c.label, c.other, r.id, p.a, p[0], c, r, p] as const;
}
export function symbolKeys(c: Copy<Branded>, i: Copy<{ [Symbol.iterator](): Iterator<number>; n: 1 }>) {
  return [c[brand], c.plain, i[Symbol.iterator], i.n] as const;
}
type Fixed = { [K in keyof Circle]: Circle[K] };
export const fixed: Fixed = { kind: "circle", radius: 1 };

type Deep<T> = { [K in keyof T]: T[K]["inner" & keyof T[K]] };
type Inner<T> = T extends unknown ? { [K in keyof T]: (T[K] & { inner: unknown })["inner"] } : never;
type Loose<T extends Record<string, { inner: unknown } | undefined>> = { [K in keyof T]: T[K]["inner"] };
export function missingProperty(
  l: Loose<{ a: { inner: 1 }; b?: { inner: 2 } }>,
  d: Deep<{ a: { inner: 1 } }>,
  i: Inner<{ a: { inner: 3 } }>,
) {
  return [l.a, l.b, d.a, i.a] as const;
}

declare function constNested<const T>(options: { items: T; loose: unknown[] }): T;
declare function constObject<const T extends Record<string, unknown>>(value: T): T;
declare function constRest<const T extends readonly unknown[]>(...values: T): T;
declare function plainArray<T extends readonly unknown[]>(values: T): T;
export const nested = constNested({ items: ["a", { b: 2 }], loose: ["c"] });
export const objectConst = constObject({ a: "x", list: [1, 2] });
export const restConst = constRest("a", [1], { k: "v" });
export const notConst = plainArray(["a", 1]);

declare function applyTo<A, R>(value: A, f: (a: A) => R): R;
function dropId<T extends { id?: number }>({ id, ...rest }: T): Omit<T, "id"> {
  return rest;
}
function identity<T>(x: T): T {
  return x;
}
function wrapIt<T>(x: T): Box<T> {
  return { value: x };
}
export const dropped = applyTo({ id: 1, name: "x" }, dropId);
export const same = applyTo("text", identity);
export const wrapped = [1, 2].map(wrapIt);
export const promised = Promise.resolve(1).then(wrapIt);
class Pipe<In> {
  constructor(readonly input: In) {}
  through<Out>(f: (value: In, extra: number) => Out | Promise<Out>): Pipe<Awaited<Out>> {
    return this as never;
  }
}
export const piped = new Pipe({ id: 1, keep: true }).through(dropId).through(wrapIt).input;

type Ask = { kind: "read"; path: string };
type Answer = string | { errno: string } | undefined;
export function* asks(paths: string[]): Generator<Ask, number, Answer> {
  let count = 0;
  for (const path of paths) {
    const answer = yield { kind: "read", path };
    if (typeof answer === "object" && "errno" in answer) {
      return answer.errno.length;
    }
    count += answer?.length ?? 0;
  }
  const inner = yield* asks([]);
  const fromArray = yield* [] as Ask[];
  return count + inner + (fromArray ?? 0);
}
export function* inferredGenerator() {
  const got: string = yield 1;
  yield got.length;
  return true;
}
export function* plainGenerator() {
  yield "a";
}
export async function* asyncGenerator(): AsyncGenerator<number, void, boolean> {
  const more = yield 1;
  if (more) yield* asyncGenerator();
}
export function iterators(m: Map<string, number>) {
  const it = m.entries();
  const step = it.next();
  if (step.done) return step.value;
  return step.value[1];
}

export function inOperator(answer: Answer, o: object, either: { a: 1 } | { b?: 2 } | { [k: string]: 3 }) {
  if (typeof answer === "object") {
    if ("errno" in answer) {
      return answer;
    }
    return answer;
  }
  if ("made" in o) {
    return o.made;
  }
  if ("a" in either) {
    return either;
  }
  if ("b" in either) {
    return either;
  }
  return either;
}

export const setOfStrings = new Set(["a", "b"]);
export const mapOfPairs = new Map([["a", 1]]);
export const fromEntries = new Map(Object.entries({ a: 1 }));
export const copied = Array.from(setOfStrings);
export const spreadSet = [...setOfStrings, ...mapOfPairs.keys()];
type Ok<T> = { ok: true; value: T };
type Err<E> = { ok: false; error: E };
declare function unwrap<T, E>(r: Ok<T> | Err<E>): [T, E];
declare const outcome: Ok<number> | Err<string>;
export const unwrapped = unwrap(outcome);
declare function orDefault<T>(value: T | string): T;
export const onlyString = orDefault("x");
export const mixed = orDefault(1 as number | string);

type Renamed<T> = { [K in keyof T as `get_${K & string}`]: T[K] };
export function mappedOverOdd(
  o: Copy<object>,
  u: Copy<{ a: 1 } | { b: 2 } | string>,
  r: Renamed<{ a: 1 } | { b: 2 } | number>,
  k: Copy<keyof Circle>,
) {
  return [o, u, r, k] as const;
}

type Block2 = { b: 1 };
type UserMsg = { role: "user"; message: { content: string | Block2[] } };
type BotMsg = { role: "bot"; message: { content: Block2[]; id: string } };
export function notADiscriminant(m: UserMsg | BotMsg) {
  if (typeof m.message.content === "string") {
    return [m.message, m.message.content, m] as const;
  }
  return [m.message, m.message.content] as const;
}
type KindA = { kind: "a"; v: string | undefined; n: number; flag: boolean; opt?: "x" };
type KindB = { kind: "b"; v: number; n: string; flag: string; opt?: "y" };
export function discriminantTests(x: KindA | KindB, y: KindA | KindB | undefined) {
  const r1 = x.v === undefined ? x : 0;
  const r2 = typeof x.n === "number" ? x : 0;
  const r3 = x.kind === "a" ? x : 0;
  const r4 = typeof x.flag === "boolean" ? x : 0;
  const r5 = x.flag === true ? x : 0;
  const r6 = x.opt === "x" ? x : 0;
  const r7 = x.opt ? x : 0;
  const r8 = x.v ? x : 0;
  const r9 = y?.kind === "a" ? y : 0;
  const r10 = typeof y?.n === "number" ? y : 0;
  return [r1, r2, r3, r4, r5, r6, r7, r8, r9, r10] as const;
}
export function afterNarrowing(x: KindA | KindB | { kind: "c"; v: 1 }) {
  if (x.kind === "c") return x;
  const still = x.kind === "a" ? x : x;
  switch (x.kind) {
    case "a":
      return x;
    default:
      return [x, still] as const;
  }
}
type Written = { ok: true; results: string[] } | { ok: false; reason: "aborted" | "refused" | "lost"; code?: string };
export function exhaustiveSwitchInside(result: Written) {
  if (!result.ok) {
    switch (result.reason) {
      case "aborted":
        return "a";
      case "refused":
        return result.code;
      case "lost":
        return "l";
    }
  }
  return result.results;
}
export function notExhaustive(result: Written) {
  if (!result.ok) {
    switch (result.reason) {
      case "aborted":
        return "a";
      case "refused":
        return result.code;
    }
  }
  return result;
}
export function exhaustiveOnAVariable(result: Written, mode: "x" | "y") {
  let seen: string | number = 1;
  switch (mode) {
    case "x":
      seen = "x";
      break;
    case "y":
      seen = "y";
      break;
  }
  return [seen, result] as const;
}

type AltA = { kind: "a"; a: number };
type AltB = { kind: "b"; b: string };
declare function wantsString(s: string): void;
declare function wantsGeneric<X>(x: X): X;
export function constraintPositions<
  T extends AltA | AltB,
  S extends string | undefined,
  O extends { x: number },
  F extends (() => 1) | (() => 2),
  K extends keyof AltA,
>(t: T, s: S, o: O, fn: F, k: K, box: { t: T; s: S }) {
  const p1 = t.kind;
  const p2 = o.x;
  const c1 = fn();
  const e1 = t["kind"];
  const plain = t;
  const inArray = [t, s];
  if (t.kind === "a") {
    const narrowed = t;
    const viaProp = t.a;
    void [narrowed, viaProp];
  }
  if (s) {
    wantsString(s);
    const kept = s;
    wantsGeneric(s);
    void kept;
  }
  const fromBox = box.t.kind;
  const boxPlain = box.t;
  if (box.s !== undefined) {
    wantsString(box.s);
  }
  const str: string | undefined = s;
  return [p1, p2, c1, e1, plain, inArray, fromBox, boxPlain, str, k] as const;
}
type Records = { count: number; label: string; flag?: boolean };
type Events2 = { count: "inc" | "dec"; label: { text: string }; flag: null };
const UPDATES: { [K in keyof Records]: (current: Records[K], event: Events2[K]) => Records[K] } = {
  count: (c, e) => (e === "inc" ? c + 1 : c - 1),
  label: (_c, e) => e.text,
  flag: c => c,
};
const REQUIRED_UPDATES: { [K in "count" | "label"]: { run(current: Records[K]): Records[K]; note?: string } } = {
  count: { run: c => c },
  label: { run: c => c },
};
declare const plainTable: { count: () => number; label: () => string };
export function correlated<K extends keyof Records, R extends "count" | "label">(
  records: Records,
  key: K,
  event: Events2[K],
  r: R,
) {
  const current = records[key];
  const update = UPDATES[key];
  const row = REQUIRED_UPDATES[r];
  const note = row.note;
  const ran = row.run(records[r]);
  const direct = REQUIRED_UPDATES[r].run(records[r]);
  const fromPlain = plainTable[r]();
  return [current, update, row, note, ran, direct, fromPlain, event] as const;
}

declare const envTable: Record<string, string | undefined>;
declare const blockTable: Record<string, unknown>;
declare const KEY_LIST: string[];
const FIXED_KEY = "fixed";
enum KeyEnum {
  A = "a",
}
export function byKey(
  key: string,
  agg: Record<string, { n: number }>,
  reassigned: string,
  o: { fixed?: string; a?: number },
) {
  const out: Record<string, string> = {};
  if (envTable[key]) {
    out[key] = envTable[key];
  }
  for (const k of KEY_LIST) {
    if (envTable[k] !== undefined) out[k] = envTable[k];
  }
  const list = KEY_LIST.flatMap(k => (blockTable[k] === undefined ? [] : [blockTable[k]]));
  if (!agg[key]) {
    agg[key] = { n: 0 };
  }
  const entry = agg[key];
  const forced = agg[key]!;
  reassigned = "x";
  const notStable = envTable[reassigned] ? envTable[reassigned] : "none";
  let mutable = "m";
  const stableLet = envTable[mutable] ? envTable[mutable] : "none";
  const viaConst = o[FIXED_KEY] ? [o[FIXED_KEY], o.fixed] : [];
  const viaEnum = o[KeyEnum.A] !== undefined ? [o[KeyEnum.A], o.a] : [];
  const other = envTable[key] ? envTable[FIXED_KEY] : "none";
  return [out, list, entry, forced, notStable, stableLet, viaConst, viaEnum, other] as const;
}
export function rejoin(incoming: { level: unknown }, u: unknown) {
  const first = incoming.level == null ? undefined : String(incoming.level);
  const after = incoming.level;
  if (u === null) void u;
  const uAfter = u;
  const t = typeof u === "string" ? u : u;
  return [first, after, uAfter, t] as const;
}

declare const PATTERN: RegExp;
export function tupleLike(s: string, pair: [number, string] | null, like: { 0: boolean; length: number } | undefined) {
  const blocks = s.match(PATTERN) ?? [];
  const orPair = pair ?? [1, "a"];
  const orLike = like ?? [true];
  const plain = (null as string[] | null) ?? [];
  const m = PATTERN.exec(s);
  if (!m) return null;
  const [open, source = "", attrs] = m;
  const first = m[0];
  const second = m[1];
  return [blocks, orPair, orLike, plain, open, source, attrs, first, second] as const;
}
interface Counters {
  increment(name: string, value?: number): void;
  label(text?: string | null): string;
}
export function makeCounters(): Counters {
  return {
    increment(name: string, value = 1) {
      void [name, value];
    },
    label: (text = "x") => String(text),
  };
}
export function annotatedDefaults2(a: number | undefined = 1, b = 2, c?: number) {
  return [a, b, c] as const;
}
type UseBlock = { type: "tool_use"; id: string } | { type: "text"; text: string };
type ResultBlock = { type: "tool_result"; tool_use_id: string } | { type: "text"; text: string };
type ChatLine =
  | { type: "user"; message: { content: string | ResultBlock[] } }
  | { type: "assistant"; message: { content: UseBlock[] } }
  | { type: "system" };
export function unionsOfArrays(m: ChatLine, either: UseBlock[] | ResultBlock[]) {
  const ids =
    (m.type === "user" || m.type === "assistant") && Array.isArray(m.message.content)
      ? m.message.content.flatMap(b =>
          b.type === "tool_use" ? [b.id] : b.type === "tool_result" ? [b.tool_use_id] : [],
        )
      : [];
  const mapped = either.map(b => b.type);
  const filtered = either.filter(b => b.type === "text");
  const some = either.some(b => b.type === "text");
  const found = either.find(b => b.type === "text");
  if (m.type === "user" && m.message) {
    const content = m.message.content;
    if (typeof content === "string" && content.trim()) return content;
  }
  return [ids, mapped, filtered, some, found] as const;
}
type Handler = ((e: { a: 1 }) => void) & ((e: { b: 2 }, extra: number) => void);
interface Overloaded {
  (x: string): number;
  (x: number): string;
}
export const combinedContexts: [Handler, Overloaded] = [(e, extra) => void [e, extra], x => x as never];

// What is destructured is what the access it stands for is known to be; `x += y` leaves `x` what it was.
interface DInner {
  v?: number;
  w: string;
}
interface DOuter {
  p?: DInner;
}
declare const dLimit: { n: number };
export function destructured1(o: DOuter) {
  if (!o.p || o.p.v === undefined) return;
  const { v, w } = o.p;
  if (dLimit.n <= v) return w;
}
export function destructured2(o: { v?: number }) {
  if (o.v === undefined) return;
  const { v } = o;
  return v - 1;
}
export function destructured3(this: { s: { v?: number } }) {
  if (this.s.v === undefined) return;
  const { v } = this.s;
  return v * 2;
}
export const destructured4 = (a: { x?: number; y?: number }, b?: { x: number; y: number }) =>
  a.x !== undefined && a.y !== undefined && b !== undefined ? { x: a.x - b.x, y: a.y - b.y } : null;
export function destructured5(xs: number[]) {
  let acc: number | null = null;
  for (const x of xs) {
    if (acc === null) {
      acc = 0;
    }
    acc += x;
  }
  return acc;
}
export async function destructured6(xs: number[], f: (n: number) => Promise<number>) {
  let acc: number | null = null;
  if (xs.length) {
    acc = 0;
    for (const x of xs) {
      acc += await f(x);
    }
  }
  return acc;
}
export function destructured7(o: { n?: number | null }) {
  return { ...(o.n !== undefined && o.n > 0 && { n: o.n }) };
}
export function destructured8(o: [number?, string?]) {
  if (o[0] === undefined) return;
  const [first] = o;
  return first + 1;
}
