declare function load(): Promise<string[]>;
declare function maybe(): boolean;

export async function assignedInTry() {
  let entries;
  try {
    entries = await load();
  } catch {
    return 0;
  }
  for (const entry of entries) {
    entry.trim();
  }
  return entries.length;
}

export function assignedOnSomePaths() {
  let value;
  if (maybe()) {
    value = "text";
  } else if (maybe()) {
    value = 1;
  }
  const seen = value;
  value = { a: 1 };
  return [seen, value] as const;
}

export function startsNull() {
  let found = null;
  let missing = undefined;
  for (const n of [1, 2, 3]) {
    if (n > 1) found = n;
  }
  const after = found;
  missing = "x";
  return [after, missing] as const;
}

export function counts() {
  let total;
  total = 0;
  total += 1;
  total++;
  return total;
}

export function capturedTooEarly() {
  let later;
  const read = () => later;
  later = 1;
  return read;
}

export function evolving() {
  const items = [];
  const empty = items;
  items.push(1);
  const one = items;
  items.push("two", true);
  items[3] = { k: 1 };
  const all = items;
  return [empty, one, all, items.length] as const;
}

export function evolvingBranches() {
  let list = [];
  if (maybe()) {
    list.push(1);
  } else {
    list.push("a");
  }
  const joined = list;
  list = ["reset"];
  return [joined, list] as const;
}

export function evolvingLoop(names: string[]) {
  const out = [];
  for (const name of names) {
    out.push(name.length);
  }
  return out;
}

export function evolvingSpread(names: string[]) {
  const out = [];
  out.push(...names);
  out.unshift(0);
  return out.map(x => x);
}

export function neverFilled() {
  const nothing = [];
  return nothing;
}

export function afterLastAssignment(input: string | undefined, other: string | number) {
  let text = input;
  if (text === undefined) {
    text = "default";
  }
  const late = () => text.length;
  if (typeof other === "number") {
    return () => other.toFixed();
  }
  return [late, () => other.trim()] as const;
}

export function assignedLater(input: string | undefined) {
  let text = input;
  if (text === undefined) return;
  const early = () => text;
  text = undefined;
  return early;
}

export function assignedInLoop(parts: (string | undefined)[]) {
  let current: string | undefined;
  const readers = [];
  for (const part of parts) {
    current = part;
    if (current !== undefined) {
      readers.push(() => current);
    }
  }
  if (current === undefined) return readers;
  return () => current;
}

export function assignedInClosure(input: string | undefined) {
  let text = input;
  const reset = () => {
    text = undefined;
  };
  if (text === undefined) return reset;
  return () => text;
}

export function parameterReassigned(value: string | null) {
  value = value ?? "x";
  return () => value;
}

declare const settings: {
  env: Record<string, string | undefined>;
  bag: Record<string, any>;
  error: Error;
  anything: any;
};
class Special extends Error {
  code = 1;
}
export function propertyNarrowing() {
  const a = settings.env.HOME && settings.env.HOME.length;
  const b = typeof settings.bag.href === "string" ? settings.bag.href : "";
  const c = settings.error instanceof Special ? settings.error.code : 0;
  const d = typeof settings.anything === "number" ? settings.anything : 0;
  const e = globalThis.process === undefined;
  return [a, b, c, d, e] as const;
}
declare global {
  var ambientBag: { slot?: string; deep: { slot: number | null } };
}
export function globalsNarrow() {
  if (ambientBag.slot && ambientBag.deep.slot !== null) {
    return [ambientBag.slot, ambientBag.deep.slot] as const;
  }
  return ambientBag.slot;
}

declare function keep<T extends Function>(f: T): T;
export const kept1 = keep((x: number) => x + 1);
export const kept2 = keep(class {});

interface Fluent {
  self(): this;
  n: number;
}
export function thisInIntersection(x: Fluent & { extra: 1 }) {
  return x.self().extra;
}

export function outOfAny(raw: string) {
  const snap = JSON.parse(raw);
  if (typeof snap?.token === "string" && snap.token) {
    return [snap.token, snap["token"]] as const;
  }
  return snap.other;
}

export function callbackOverloads(p: string, q: string | undefined) {
  const a = p.replace(/[A-Z]/g, c => c.toLowerCase());
  const b = q?.replace(/x/, (whole, ...rest) => whole + rest.length) ?? null;
  return [a, b] as const;
}
declare function either(value: string): 1;
declare function either(value: { name: string }): 2;
declare function either(value: (n: number) => void): 3;
export const eithers = [either("s"), either({ name: "n" }), either(n => n.toFixed())] as const;

const FAILED: unique symbol = Symbol("failed");
interface AllOptional {
  a?: string;
  b?: number;
}
declare const strict: (() => Promise<AllOptional | null | typeof FAILED>) | undefined;
declare function loose(): Promise<AllOptional | null>;
export async function weakTypesInUnions(n: number, s: string) {
  const result = await (strict?.() ?? loose());
  const pick = n > 1 ? ({} as AllOptional) : s;
  const list = [{} as AllOptional, n, FAILED];
  return [result, pick, list] as const;
}

type Row = { id: string; note?: string };
type RestoredRow = Row & { restored?: boolean };
type WideRow = { id: string; note?: string; restored?: boolean };
export function subtypeTies(
  rows: Row[],
  wide: WideRow[],
  onExit: ((code?: number) => void) | undefined,
  exit: () => void,
  given: (Row & { extra?: 1 }) | undefined,
) {
  const both = [...rows, ...wide];
  const other = [...wide, ...rows];
  const f = onExit ?? exit;
  const g = given || { id: "x", note: "y" };
  const h = rows.length ? { id: "a" } : { id: "b", note: "n" };
  return [both, other, f, g, h] as const;
}
export function returnsEither(flag: boolean) {
  if (flag) return { data: 1 };
  return { data: 2, ...(flag ? { after: () => {} } : {}) };
}
export function returnsEitherReversed(flag: boolean) {
  if (flag) return { data: 2, ...(flag ? { after: () => {} } : {}) };
  return { data: 1 };
}

export function normalized(flag: boolean, n: number) {
  const either = flag ? { ok: true, value: n } : { ok: false, error: "e" };
  const nested = flag ? { at: { x: 1 } } : { at: { y: 2 }, more: 1 };
  const list = [{ a: 1 }, { b: "two" }, { a: 3, c: true }];
  const withSpread = flag ? { ...either, extra: 1 } : { plain: 1 };
  const withEmpty = flag ? {} : { some: 1 };
  const withNull = flag ? null : { some: 1 };
  const viaVariables = flag ? either : nested;
  return { either, nested, list, withSpread, withEmpty, withNull, viaVariables };
}
export function normalizedReturns(kind: number) {
  if (kind === 0) return { kind: "zero" as const };
  if (kind === 1) return { kind: "one" as const, payload: [kind] };
  return { kind: "many" as const, payload: [kind], count: kind };
}
declare function pass<T>(x: T): T;
export const inferredFromLiterals = pass(Math.random() > 0.5 ? { p: 1 } : { q: 2 });
export const arrow = (f: boolean) => (f ? { l: 1 } : { r: 2 });
export class Holder {
  field = Math.random() > 0.5 ? { m: 1 } : { n: 2 };
}

type Entry = { title: string; multiple?: boolean };
export function orEmpty(ctx: { mates?: { [id: string]: Entry } } | undefined, list: Entry[] | undefined) {
  const mates = ctx?.mates ?? {};
  const found = Object.entries(mates).find(([, t]) => t.title === "x");
  const items = list ?? [];
  return [mates, found, items, Object.entries({ x: 1, y: "z" })] as const;
}
declare function read(
  path: string,
  options?: ({ encoding?: null; flag?: string } & { signal?: AbortSignal }) | null,
): Uint8Array;
declare function read(
  path: string,
  options: ({ encoding: string; flag?: string } & { signal?: AbortSignal }) | string,
): string;
export const reads = [
  read("p"),
  read("p", "utf8"),
  read("p", { encoding: "utf8" }),
  read("p", { flag: "r" }),
  read("p", null),
] as const;

import once from "./lib/once";
import { twice, version, type Extra } from "./lib/toolbox";
import "./lib/toolbox-more";
export const getHome = once((): string => "home");
export function usesToolbox(e: Extra) {
  return [getHome(), getHome.called, version, e.n] as const;
}
export const doubled = twice(2);

export function spreadsWithIndex(bag: Record<string, number>, other: { [k: string]: string }, known: { a: 1 }) {
  const onlyBag = { ...bag };
  const knownThenBag = { ...known, ...bag };
  const bagThenKnown = { ...bag, ...known };
  const written = { x: 1, ...bag };
  const both = { ...bag, ...other };
  return { onlyBag, knownThenBag, bagThenKnown, written, both };
}

class Step<In> {
  constructor(readonly input: In) {}
  then<Out>(f: (value: In, extra: number) => Out | Promise<Out>): Step<Awaited<Out>> {
    return this as never;
  }
}
function keepIf<T>(name: string, valid: (v: T) => boolean): (v: T) => T | undefined {
  return v => (valid(v) ? v : undefined);
}
function constant<T>(value: T): () => T {
  return () => value;
}
export const nestedGeneric = new Step("text").then(keepIf("n", v => v.length > 0)).input;
export const nestedConstant = new Step(1).then(constant({ k: "v" })).input;
declare function both<A, B>(a: A, f: (a: A) => B): [A, B];
export const usesEarlierArgument = both(
  1,
  keepIf("n", v => v > 0),
);
export const promiseOfNested: Promise<string[]> = Promise.resolve([]).then(constant([]));
export function nestedInOverloaded(x: string[][]) {
  return [x.flat(), new Set(x.flat()), Array.from(x.flat()), new Map(x.map(r => [r.length, r] as const))] as const;
}
export function expectedReadonly(x: string[][]) {
  const a: readonly unknown[] = x.flat();
  const b: Iterable<unknown> = x.flat();
  return [a, b, x.flat().length] as const;
}

declare function cleanup(): void;
export async function tryFinally(input: string | undefined) {
  let result;
  let narrowed = input;
  try {
    if (narrowed === undefined) throw new Error("none");
    result = await load();
  } finally {
    const inFinally = [result, narrowed] as const;
    cleanup();
    void inFinally;
  }
  return [result, narrowed] as const;
}
export function tryCatchFinally() {
  let value: string | number | undefined;
  try {
    value = "tried";
    cleanup();
  } catch {
    value = 1;
  } finally {
    const seen = value;
    void seen;
  }
  return value;
}
export function returnsInTry(flag: boolean) {
  let x;
  try {
    if (flag) return "early";
    x = 1;
  } finally {
    cleanup();
  }
  return x;
}
export function onlyReturnsInTry() {
  try {
    return 1;
  } finally {
    cleanup();
  }
}
export function nestedFinally() {
  let a;
  let b;
  try {
    try {
      a = 1;
      cleanup();
    } finally {
      b = "inner";
    }
    a = "after";
  } finally {
    const outer = [a, b] as const;
    void outer;
  }
  return [a, b] as const;
}

type K1 = { a: 1; b: 1; c: 1; shared: 1; 0: 1 };
type K2 = { b: 2; c: 2; d: 2; shared: 2; 0: 2 };
type K3 = { c: 3; e: 3; shared: 3; [k: string]: number };
export function commonKeys(
  k12: keyof (K1 | K2),
  k123: keyof (K1 | K2 | K3),
  s: ("a" | "b" | 1) & (string | 2),
  n: ("a" | 1 | 2) & ("b" | 2 | 3),
) {
  return [k12, k123, s, n] as const;
}

declare function compute(): string;
export class Lazy {
  private cached: string | undefined = undefined;
  private count: number | null = null;
  get(): string {
    this.cached ??= compute();
    return this.cached;
  }
  bump() {
    this.count ||= 1;
    const afterOr = this.count;
    this.count &&= afterOr + 1;
    return [afterOr, this.count] as const;
  }
}
export function logicalAssignments(a: string | undefined, b: number | null, c: string | undefined) {
  a ??= "x";
  b ||= 2;
  c &&= c.trim();
  let auto;
  auto ??= 1;
  return [a, b, c, auto] as const;
}

export function destructuredLiterals(p: string, q: number) {
  const [a, b] = [p.trim(), q + 1];
  const [c, [d, e], ...rest] = [p, [q, p], q, q];
  const [f = 1, g] = [undefined, p];
  const {
    h,
    i: [j],
  } = { h: p, i: [q] };
  let x = p;
  let y = p;
  [x, y] = [y, x];
  return [a, b, c, d, e, rest, f, g, h, j, x, y] as const;
}
export function pairsForMaps(list: { id: string; n: number }[]) {
  const byId = new Map(list.map(s => [s.id, s]));
  const found = byId.get("x");
  const entries = Object.fromEntries(list.map(s => [s.id, s.n]));
  return [byId, found, entries] as const;
}

declare function fetchText(): Promise<string>;
declare function fetchCount(): Promise<number>;
export async function patternIsNoAnswer() {
  const [text, count] = await Promise.all([fetchText(), fetchCount()]).catch(err => {
    throw err;
  });
  const [first] = pass([1, "a"]);
  const { made } = pass({ made: [1] });
  return [text, count, first, made] as const;
}
declare function uniq<T>(list: ArrayLike<T> | null | undefined, key: (t: T) => unknown): T[];
export function literalsInNestedCallbacks(files: string[]) {
  return uniq(
    [
      ...files.flatMap(file => [
        ...[file].flatMap(name => [
          { literal: name, tail: "" as const, place: name === file },
          { literal: name, tail: ".*" as const, place: false },
        ]),
        { literal: file, tail: file, place: false },
      ]),
    ],
    x => x.literal,
  );
}

type Pattern = { literal: string; place: boolean; tag: "a" | "b" | string };
export function spreadHasNoContext(files: string[]): Pattern[] {
  const direct: Pattern[] = files.map(f => ({ literal: f, place: false, tag: "a" }));
  const spread = [...files.map(f => ({ literal: f, place: false, tag: "a" }))];
  const typedSpread: Pattern[] = [
    ...files.map(f => ({ literal: f, place: false, tag: "a" })),
    { literal: "x", place: true, tag: "b" },
  ];
  return uniq([...files.flatMap(f => [{ literal: f, place: false, tag: "a" }])], x => x.literal).concat(
    direct,
    spread,
    typedSpread,
  );
}

type Outcome<T> = { success: true; data: T; error?: never } | { success: false; data?: never; error: Error };
export function guardsFromProperties(list: Outcome<string>[], flags: boolean[], maybe: (string | null)[]) {
  const ok = list.filter(r => r.success).map(r => r.data);
  const failed = list.filter(r => !r.success).map(r => r.error);
  const same = flags.filter(f => f);
  const truthy = maybe.filter(m => !!m);
  const always = list.filter(() => true);
  return [ok, failed, same, truthy, always] as const;
}

export function unknownIsThree(u: unknown, bag: { slot: unknown }) {
  const a = u !== undefined ? u : 0;
  const b = u !== null ? u : 0;
  const c = u != null ? u : 0;
  const d = u === undefined ? u : 0;
  const e = u === null ? u : 0;
  const f = u == null ? u : 0;
  const g = bag.slot !== undefined && bag.slot !== null ? bag.slot : 0;
  const h = u ? u : 0;
  return [a, b, c, d, e, f, g, h] as const;
}
interface Reply<T = any, D = any> {
  data: T;
  sent: D;
}
declare function post<T = any, R = Reply<T>, D = any>(url: string, data?: D): Promise<R>;
export async function defaultsMentionEarlier() {
  const plain = await post("u");
  const withData = await post("u", { k: 1 });
  const given = await post<string>("u");
  return [plain, withData, given] as const;
}

type LineA = { type: "a"; items: number[]; note?: string };
type LineB = { type: "b"; text: string | number[] };
type LineC = { type: "c" };
export function manyJoinsInLoops(lines: (LineA | LineB | LineC)[], flags: boolean[]) {
  let total = 0;
  for (const line of lines) {
    if (line.type === "a" && line.items) {
      for (const item of line.items) {
        for (const flag of flags) {
          if (flag && item > 0) total += 0;
          else if (item < -0) total -= 0;
          if (flag && item > 1) total += 1;
          else if (item < -1) total -= 1;
          if (flag && item > 2) total += 2;
          else if (item < -2) total -= 2;
          if (flag && item > 3) total += 3;
          else if (item < -3) total -= 3;
          if (flag && item > 4) total += 4;
          else if (item < -4) total -= 4;
          if (flag && item > 5) total += 5;
          else if (item < -5) total -= 5;
          if (flag && item > 6) total += 6;
          else if (item < -6) total -= 6;
          if (flag && item > 7) total += 7;
          else if (item < -7) total -= 7;
          if (flag && item > 8) total += 8;
          else if (item < -8) total -= 8;
          if (flag && item > 9) total += 9;
          else if (item < -9) total -= 9;
          if (flag && item > 10) total += 10;
          else if (item < -10) total -= 10;
          if (flag && item > 11) total += 11;
          else if (item < -11) total -= 11;
          if (flag && item > 12) total += 12;
          else if (item < -12) total -= 12;
          if (flag && item > 13) total += 13;
          else if (item < -13) total -= 13;
          if (flag && item > 14) total += 14;
          else if (item < -14) total -= 14;
          if (flag && item > 15) total += 15;
          else if (item < -15) total -= 15;
          if (flag && item > 16) total += 16;
          else if (item < -16) total -= 16;
          if (flag && item > 17) total += 17;
          else if (item < -17) total -= 17;
        }
      }
      void line.note;
    }
    if (line.type === "b" && line.text) {
      const text = line.text;
      if (typeof text === "string" && text.trim()) total += text.length;
    }
  }
  return total;
}

// Loops that nothing leads to.
export function afterForever(x: string | number) {
  while (true) {}
  while (x) {
    x = typeof x === "string" ? 1 : "a";
  }
  for (;;) {
    const inside = x;
  }
  return x;
}
