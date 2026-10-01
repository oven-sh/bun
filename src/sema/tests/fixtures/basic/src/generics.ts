type Builtin = Date | Function | Uint8Array | string | number | boolean | undefined
type DeepPartial<T> = T extends Builtin ? T
  : T extends globalThis.Array<infer U> ? globalThis.Array<DeepPartial<U>>
  : T extends ReadonlyArray<infer U> ? ReadonlyArray<DeepPartial<U>>
  : T extends {} ? { [K in keyof T]?: DeepPartial<T[K]> }
  : Partial<T>
type KeysOfUnion<T> = T extends T ? keyof T : never
type Exact<P, I extends P> = P extends Builtin ? P
  : P & { [K in keyof P]: Exact<P[K], I[K]> } & { [K in Exclude<keyof I, KeysOfUnion<P>>]: never }
interface Meta {
  actor?: string | undefined
  count: number
  nested?: { deep: boolean } | undefined
  list: string[]
}
export function fromPartial<I extends Exact<DeepPartial<Meta>, I>>(object: I) {
  const a = object.actor ?? ''
  const c = object.count
  const n = object.nested?.deep
  const l = object.list?.map(e => e) || []
  return [a, c, n, l] as const
}
export function qualifiedByGlobalThis(a: globalThis.Array<number>, m: globalThis.Map<string, globalThis.Date>, e: globalThis.Error) {
  return [a[0], m.get('k'), e.message, globalThis.parseInt('1'), typeof globalThis.undefined] as const
}

type Out<T> = T extends { out: infer O } ? O : never
interface Schema<O> {
  out: O
  refine<Ch extends (arg: Out<this>) => unknown>(check: Ch): this
  each<F extends (item: O, index: number) => void>(f: F): F
  pick<K extends keyof O>(key: K, use: (value: O[K]) => void): K
}
declare const text: Schema<string>
declare const record: Schema<{ a: number; b: string }>
export const refined = text.refine(value => value.length > 0)
export const eached = record.each((item, i) => item.a + i)
export const picked = record.pick('b', v => v.trim())
declare function stable<T extends Function>(callback: T, deps: unknown[]): T
export const expectedWins: (msg: string | undefined, n: number) => void = stable((msg, n) => void [msg, n], [])
export const constraintOnly = stable((x: number) => x, [])

type Letter = 'a' | 'b' | 'c'
export const LETTERS = { a: 'A', b: 'B' } satisfies Record<Exclude<Letter, 'c'>, string>
interface Point { x: number; y: number }
export function objectStatics(point: Point, partial: Partial<Record<Letter, string[]>>) {
  const v1 = Object.values(LETTERS).filter(k => k.length)
  const v2 = Object.values(point)
  const e1 = Object.entries(point)
  const e2 = Object.entries(partial)
  for (const [k, list] of Object.entries(partial)) {
    void [k, list]
  }
  return [v1, v2, e1, e2, Object.keys(LETTERS)] as const
}

import './lib/widgets'
export type Render = (name: string) => Promise<Widgets.Node>
export const render: Render = async name => ({ tag: name })
export function umdTypes(e: Widgets.Element, n: Widgets.Node) {
  return [e.tag, n] as const
}

type Token = { jwt: string }
declare function register(t: string, u: () => void): Promise<Token | null>
declare function withRetry<T>(fn: (t: string, u: () => void, o: { n: number }) => Promise<T | null>, label: string): Promise<T | null>
export const retried = withRetry((t, u) => register(t, u), 'l')
export const retriedBlock = withRetry((t, u, o) => {
  void o.n
  return register(t, u)
}, 'l')
interface Holder<T> {
  value: T
  plain(cb: () => void): number
  uses(cb: (v: T) => void): this
  literal: { fixed: string }
}
export function holders<U>(h: Holder<U>, s: Holder<string>) {
  return [h.plain, h.uses, h.literal, s.plain, s.uses(v => v.trim()), s.literal.fixed] as const
}

import './lib/kit-voice'
import type { Engine } from './lib/kit'
import type { Engine as Direct, State } from './lib/kit/engine'
export function augmentedThroughStar(e: Engine, d: Direct, s: State) {
  return [e, d, e.voice.say, d.voice, e.clock.now(), s.open] as const
}

interface Merged<T> {
  pick(): T
}
interface Merged<T> {
  pick(index: number): T | undefined
}
type Branded = string[] & { __brand: 'x' }
export function overloadsAcrossDeclarations(m: Merged<string>, plain: string[], b: Branded, ia: Int32Array & { 0: number }) {
  return [m.pick, m.pick(), m.pick(1), plain.toLocaleString, b.toLocaleString, ia.toLocaleString, plain.toLocaleString('en')] as const
}
export function chainCalls(kind: string | undefined, list: string[] | null) {
  if (kind?.startsWith('a')) {
    return kind.slice(1)
  }
  if (!list?.includes('x')) {
    return list
  }
  return list.length
}
export function storedChainCalls(handle: { element(): object | null; size: number } | null) {
  const box = handle?.element()
  const size = handle?.size
  const viaCall = box ? handle : 0
  const viaProperty = size ? handle : 0
  return [viaCall, viaProperty] as const
}

type Saved = { ok: true; created: string[] }
type Refused = { ok: false; reason: string }
type Result2 = Saved | Refused
type OnlyRefused = Result2 & { ok: false }
type Tagged = ({ kind: 'a'; a: 1 } | { kind: 'b'; b: 2 }) & { kind: 'a' | 'c' }
export function impossibleIntersections(r: OnlyRefused, t: Tagged, both: Saved & Refused, same: { n: number } & { n: string }) {
  return [r.reason, r.ok, t.kind, t, r, both, same.n] as const
}

declare const anything: any
declare function elementOf<T>(x: T[]): T
declare function boxed2<T>(x: { v: T }): T
declare function bare<T>(x: T): T
declare function promised<T>(x: Promise<T>): T
declare function called<T>(x: () => T): T
declare function makes<T extends object>(): { made: T }
export const fromAny = [
  elementOf(anything),
  boxed2(anything),
  bare(anything),
  promised(anything),
  called(anything),
  Object.entries(anything),
  Array.from(anything),
  new Set(anything),
  bare<{ k: any }>({ k: makes() }),
] as const
export const expectedAny: any = makes()

declare function newId(kind?: string): string
export function annotatedDefaults({ id = newId, n = 1, s }: { id?: () => string; n?: number | string; s?: string }, [first = 'x']: [string?] = []) {
  return [id, n, s, first] as const
}
export function inferredDefaults({ id = newId, n = 1 } = {} as { id?: () => string; n?: string }) {
  return [id, n] as const
}
type Ports = { off(): boolean; now(): number; pick(x: string): string }
export function sameSignatures(p: Ports & { off(): boolean; now: () => number; pick(x: number): number }) {
  return [p.off, p.now, p.pick, p] as const
}

interface Node2 {
  maybe(): Wrapped<this>
  self: this
}
interface Wrapped<T> {
  inner: T
}
interface Leaf extends Node2 {
  leaf: true
}
const wrapAny = <T extends Node2>(inner: T) => inner.maybe()
export function thisIsTheParameter<T extends Node2>(t: T, leaf: Leaf) {
  return [t.maybe(), t.self, wrapAny(leaf), wrapAny(leaf).inner.leaf, wrapAny(t)] as const
}

type Note = { id?: string; body: string }
export function spreadsOfParameters<T extends Note>(list: T[], id: string | undefined): T[] {
  const copied = list.map(m => ({ ...m }))
  const maybe = list.map(m => ({ ...m, ...(id !== undefined && { id }) }))
  const either = list.map(m => (id ? { ...m, id } : m))
  const twice = list.map(m => ({ ...m, a: 1, ...{ b: 2 } }))
  void [copied, maybe, either, twice]
  return list.map(m => {
    const add = m.id === undefined && id !== undefined
    return add ? { ...m, ...(add && { id }) } : m
  })
}

type Yes = { yes: 1 }
type No = { no: 1 }
type IsNever<T> = [T] extends [never] ? Yes : No
type ArrayOfNever<T> = T[] extends never[] ? Yes : No
type FieldIsNever<T> = { a: T } extends { a: never } ? Yes : No
type NoKeysLeft<P> = [{ [K in keyof P]-?: K extends 'zzz' ? K : never }[keyof P]] extends [never] ? Yes : No
type AnyToNever = [any] extends [never] ? Yes : No
export declare const nevers: [
  IsNever<never>,
  IsNever<string>,
  ArrayOfNever<never>,
  ArrayOfNever<1>,
  FieldIsNever<never>,
  FieldIsNever<1>,
  NoKeysLeft<{ readonly name: 'x' }>,
  NoKeysLeft<{ zzz: 1 }>,
  AnyToNever,
]
export function stillGeneric<T>(a: IsNever<T>, b: [T] extends [unknown] ? Yes : No) {
  return [a, b] as const
}

type Limit = 8
type ByOne<V, Q, D extends readonly unknown[]> = V extends readonly (infer Item)[]
  ? [Fits<Item, Q, [...D, unknown]>] extends [never] ? never : V
  : Q extends RegExp ? V
  : Q extends object ? (V extends object ? Fitted<V, Q, [...D, unknown]> : never)
  : V extends Q ? V
  : Q extends V ? Q
  : never
type Fits<V, Q, D extends readonly unknown[]> = D['length'] extends Limit ? V : unknown extends V ? V : ByOne<V, Q, D>
type Misfits<E, P, D extends readonly unknown[]> = {
  [K in keyof P]-?: K extends keyof E ? ([Fits<Exclude<E[K], undefined>, P[K], D>] extends [never] ? K : never) : K
}[keyof P]
type Fitted<E, P, D extends readonly unknown[]> = [Misfits<E, P, D>] extends [never]
  ? { [K in keyof E]: K extends keyof P ? Fits<E[K], P[K], D> : E[K] }
  : never
type Section = { name: string; text: string | null; at?: { line: number; tags: string[] } }
export declare const fitted: [
  Fitted<Section, { readonly name: 'simple' }, []>,
  Fitted<Section, { readonly name: 1 }, []>,
  Fitted<Section, { readonly other: 1 }, []>,
  Fitted<Section, { readonly at: { readonly line: 3 } }, []>,
  Misfits<Section, { readonly name: 'simple' }, []>,
]
declare function when<const M>(matcher: M, hook: (e: Fitted<Section, M, []>) => void): void
when({ name: 'simple' }, e => void [e.name, e.text])

type OldNames = 'old.Start' | 'old.Stop' | 'old.Skip'
type Bare = Exclude<OldNames, 'old.Skip'> extends `old.${infer E}` ? E : never
type MixedPrefixes = ('old.A' | 'new.B') extends `old.${infer E}` ? { e: E } : { none: 1 }
type ByBare = { [E in Bare]: (e: E) => `old.${E}` }
type Calls = { session: { start(x: number): void; stop(): void }; ui: { render(): void; resolve(): void } }
type AllCalls = 'session.start' | 'session.stop' | 'ui.render' | 'ui.resolve'
type Results = { 'session.start': { cwd: string }; 'session.stop': null; 'ui.render': 1; 'ui.resolve': 2 }
type Verbs<N extends keyof Calls> = Exclude<keyof Calls[N] & string, `${N}.resolve` extends 'ui.resolve' ? 'resolve' : never>
type CallOf<E extends AllCalls> = E extends 'ui.render' ? never : (e: E) => Promise<Results[E]>
type Noun<N extends keyof Calls> = {
  [V in Verbs<N>]: `${N}.${V}` extends 'ui.render' ? Calls[N][V] : CallOf<`${N}.${V}` & AllCalls>
}
type Kit = { [N in keyof Calls]: N extends 'ui' ? Noun<N> & { press(): void } : Noun<N> } & { old: ByBare }
export declare const templates: [
  { v: Bare },
  MixedPrefixes,
  ByBare,
  { s: Verbs<'session'>; u: Verbs<'ui'> },
  Noun<'session'>,
  Noun<'ui'>,
  { fits: `a${string}` & 'abc' },
  { cannot: `a${string}` & 'xyz' },
  { wider: string & `a${string}` },
  { other: `a${string}` & number },
  { upper: Uppercase<string> & 'ABC' },
  { notUpper: Uppercase<string> & 'abc' },
]
export async function usesKit<N extends string>($: Kit, waiting: { v: `${N}.x` & ('a.x' | 'b.x') }) {
  return [await $.session.start('session.start'), $.ui.render, $.ui.press, $.old.Start, waiting.v] as const
}

declare class Finder<T> {
  constructor(items: T[])
  search<R = T>(pattern: string): { item: R }[]
  pair<A, B = T>(a: A): [A, B]
  keyed<K extends keyof T = keyof T>(): K
  only<K extends keyof T>(k: K): T[K]
}
export function defaultsFromTheReceiver(f: Finder<{ id: number; name: string }>) {
  return [f.search('x'), f.search<string>('x'), f.pair(1), f.pair<1>(1), f.keyed(), f.only('id'), new Finder(['a']).search('a')] as const
}

declare function viaUnion<R = string>(f: () => R | PromiseLike<R>): { r: R }
declare function valueOrList<R = string>(v: R | R[]): { r: R }
declare const nothing: never
export function neverIsACandidate(p: Promise<void>) {
  return [
    viaUnion((): never => { throw 1 }),
    viaUnion(() => { throw 1 }),
    valueOrList(nothing),
    p.then((): never => { throw 1 }),
    p.then(() => { throw 1 }),
    Promise.race([p, p.then((): never => { throw 1 })]),
  ] as const
}

export function lazily<A extends unknown[], R>(get: () => (...args: A) => R): (...args: A) => R {
  return (...args) => get()(...args)
}
export function leading<A extends unknown[], R>(f: (first: string, ...rest: A) => R): (first: string, ...rest: A) => R {
  return (first, ...rest) => f(first, ...rest)
}
export function wholeList<A extends unknown[], R>(f: (first: string, ...rest: A) => R): (first: string, ...rest: A) => R {
  return (...all) => f(...all)
}
declare function takesTuple(cb: (...args: [a: number, b?: string]) => void): void
declare function takesMany(cb: (...args: number[]) => void): void
declare function takesMixed(cb: (a: boolean, ...args: [b: number, ...c: string[]]) => void): void
takesTuple((...args) => void args)
takesTuple((a, ...rest) => void [a, rest])
takesTuple((a, b, ...rest) => void [a, b, rest])
takesMany((...args) => void args)
takesMany((a, ...rest) => void [a, rest])
takesMixed((...args) => void args)
takesMixed((a, ...rest) => void [a, rest])
takesMixed((a, b, ...rest) => void [a, b, rest])
takesMixed((a, b, c, ...rest) => void [a, b, c, rest])
export declare const parameterLists: [
  Parameters<(a: number, b?: string) => void>,
  Parameters<(a: number, ...rest: boolean[]) => void>,
  Parameters<(...args: [x: 1, y?: 2]) => void>,
]

declare function failWith(msg: string): never
declare function logLine(msg: string): void
declare function onEvent(cb: () => void | Promise<void>): void
declare function wantsUndefined(cb: () => undefined): void
declare const cond: boolean
export async function neverThenEnd() {
  if (cond) return failWith('x')
  logLine('y')
}
export function neverOrEnd() {
  if (cond) return failWith('x')
}
export function bareReturn() {
  if (cond) return
  logLine('y')
}
export function voidThenEnd() {
  if (cond) return logLine('a')
  logLine('y')
}
export function undefinedThenEnd() {
  if (cond) return undefined
  logLine('y')
}
export function voidOrUndefined() {
  if (cond) return logLine('a')
  return undefined
}
onEvent(async () => {
  if (cond) return failWith('x')
  logLine('y')
})
onEvent(() => {
  if (cond) return logLine('a')
  return undefined
})
wantsUndefined(() => {})
wantsUndefined(() => {
  logLine('y')
})
export const voidOrUndefinedExpr = () => (cond ? logLine('a') : undefined)
export const onlyNever = () => {
  return failWith('x')
}

type Entry = { path: string }
declare function findEntry(p: string): Entry | undefined
declare const noItems: never[]
declare function flat<U>(v: U | ReadonlyArray<U>): U[]
declare function readsAndWrites<U>(a: ReadonlyArray<U>, put: (u: U) => void, other: (u: U) => void): U
export function arraysCountAsOne(paths: string[], word: string) {
  return [
    paths.flatMap(p => findEntry(p) ?? []),
    paths.flatMap(p => (cond ? [p] : [])),
    paths.flatMap(p => (cond ? p : [])),
    flat(cond ? word : noItems),
    flat(cond ? noItems : word),
    flat(cond ? word : []),
    readsAndWrites([1], (u: number | string) => void u, (u: number) => void u),
  ] as const
}
export function oneReturnKeepsItsUnion(handler: ((m: string) => void | Promise<void>) | undefined) {
  return [(m: string) => handler?.(m), (m: string) => { return handler?.(m) }] as const
}
export function callsOnUnions(known: ReadonlyMap<string, { state: string }> | undefined, either: { get(): { a: 1 } } | { get(): { a: 1; b: 2 } }) {
  const entries = (known ?? new Map()).entries()
  const listed = [...(known ?? new Map()).entries()].filter(([, r]) => r.state === 'x')
  return [entries, listed, either.get()] as const
}

type Spec = { supported: true; fields?: string[] } | { supported: false }
export const OFF: Spec = Object.freeze({ supported: false })
export const OFF_PLAIN: Spec = { supported: false }
export const frozen = Object.freeze({ s: 'x', n: 1, nested: { b: true } })
export const SPEC_DEFAULTS = { a: OFF, b: OFF_PLAIN }
export function narrowedByInitialiser(d: typeof SPEC_DEFAULTS) {
  return [d.a, d.b, OFF, OFF_PLAIN] as const
}
type Prim = string | boolean | number
declare function fnOrRecord<T extends Function>(f: T): T
declare function fnOrRecord<T extends { [k: string]: U | object }, U extends Prim>(o: T): T
declare function fnOrRecord<T>(o: T): T
export const keptLiteral = fnOrRecord({ s: false })
type Shape2 = { kind: 'circle'; r: number; label: 'c' | 'C' } | { kind: 'square'; side: number; label: string }
declare function draw(s: Shape2): void
declare function drawEither(s: Shape2): void
declare function drawEither(s: string): void
draw({ kind: 'circle', r: 1, label: 'c' })
drawEither({ kind: 'square', side: 1, label: 'c' })
export const shapes2: Shape2[] = [{ kind: 'circle', r: 1, label: 'C' }, { kind: 'square', side: 2, label: 'x' }]

import { BATCH_EDIT, BATCH_READ, EDIT, READ } from './lib/names'
export const BY_COMPUTED_KEY = {
  [BATCH_READ]: READ,
  [BATCH_EDIT]: EDIT,
  [`t${1}`]: EDIT,
} as const
export const BY_PLAIN_KEY = { r: READ, e: EDIT, list: [READ, EDIT] } as const
export const readsOfTables = { a: BY_COMPUTED_KEY[BATCH_EDIT], b: BY_PLAIN_KEY.e, c: BY_PLAIN_KEY.list[0], direct: EDIT }
export let mutableFromTable = BY_COMPUTED_KEY[BATCH_EDIT]
type NamedDef = { name: string; under: string }
declare function buildNamed<D extends NamedDef>(d: D): D
declare function constArg<const T>(t: T): T
export const builtNamed = buildNamed({ name: BATCH_EDIT, under: BY_COMPUTED_KEY[BATCH_EDIT] } satisfies NamedDef)
export const constUnderComputed = constArg({ [BATCH_EDIT]: EDIT, plain: [1, 'x'] })

const PART = 'x'
const COUNT = 2
let mutablePart = 'm'
declare const declaredPart: 'd'
enum Tint { Red = 'red', Blue = 'blue' }
enum Ordinal { One = 1, Two }
export const evaluatedInConst = {
  t1: `p${PART}`,
  t2: `p${1}`,
  t3: `${PART}-${COUNT}`,
  t4: `${EDIT}_suffix`,
  t5: `p${mutablePart}`,
  t6: `p${declaredPart}`,
  t7: `p${Tint.Red}`,
  t8: `p${Ordinal.Two}`,
  t9: `p${COUNT + 1}`,
  t10: `p${PART + 'y'}`,
  t11: `p${-COUNT}`,
  t12: `${`in${PART}`}out`,
  t13: `${0.5}|${1e21}|${COUNT / 4}`,
  t14: `${1.5e-7}|${1e-6}|${123456789012345680000}|${-0}|${1 / 3}|${2 ** 70}`,
} as const
const evaluated1 = `p${PART}`
const evaluated2 = `${EDIT}_suffix`
const notEvaluated = `p${declaredPart}`
const emptyOne = `${''}`
export const evaluatedOutside = { evaluated1, evaluated2, notEvaluated, emptyOne, plus: PART + 'y', num: COUNT + 1 } as const
export const evaluatedKeys = { [`k${PART}`]: 1, [`${EDIT}Key`]: 2, [PART + 'z']: 3 }
export let widenedWhenMutable = `p${PART}`
const usesLater = `p${declaredLater}`
const declaredLater = 'late'
export const evaluatedBeforeDeclared = { usesLater } as const
enum FromConstants { A = COUNT, B = `b${PART}`, C = COUNT * 2 }
export const enumFromConstants = [FromConstants.A, FromConstants.B, FromConstants.C] as const

type Flat<T> = { [k in keyof T]: T[k] }
type Extended<A, B> = Flat<keyof A & keyof B extends never ? A & B : { [K in keyof A as K extends keyof B ? never : K]: A[K] } & { [K in keyof B]: B[K] }>
type LooseRecord = Record<string, any>
type BaseFields = { id: number; name: string }
type Pick1<T> = T extends 'a' ? { hit: 1; both: 1 } : { miss: 2; both: 2 }
type AnyBranch<T> = T extends string ? any : { known: 1 }
export function constraintsOfConditionals<U extends LooseRecord, V extends { extra: boolean }, W, S extends string, N extends number, M extends 'a' | 1>(
  a: Extended<BaseFields, U>,
  b: Extended<BaseFields, V>,
  c: Extended<BaseFields, W>,
  d: Flat<U extends string ? { x: 1; y: 2 } : { x: 3; z: 4 }>,
  e: Flat<W extends string ? { x: 1 } : never>,
  s: Pick1<S>,
  n: Pick1<N>,
  m: Pick1<M>,
  w: Pick1<W>,
  y: AnyBranch<W>,
) {
  return [a, b, c, d, e, s.both, n.both, n.miss, m.both, w.both, y.known, Object.keys(s), { ...n }] as const
}

type Provider = 'a' | 'b' | 'c'
type VarName = 'USE_A' | 'USE_B' | 'USE_C'
export const LITERAL_TABLE = { a: 'USE_A', b: 'USE_B' } satisfies Record<Exclude<Provider, 'c'>, VarName>
export const CONST_TABLE = { a: 'USE_A', b: 'USE_B' } as const
declare const lookup: Record<string, string | undefined>
export const valuesOfLiteralTables = [
  Object.values(LITERAL_TABLE),
  Object.values(LITERAL_TABLE).filter(k => lookup[k]),
  Object.values(CONST_TABLE).filter(k => lookup[k]),
  Object.entries(LITERAL_TABLE),
  Object.values({ a: 'x', n: 1 } as const),
] as const

type NoMap = [never]
type MapOf<T> = Record<keyof T, any[]> | NoMap
type KeyOf<K, T> = T extends NoMap ? string | symbol : K | keyof T
type ListenerOf<K, T, F> = T extends NoMap ? F : K extends keyof T ? (T[K] extends unknown[] ? (...args: T[K]) => void : never) : never
type Listener1<K, T> = ListenerOf<K, T, (...args: any[]) => void>
interface Emitter<T extends MapOf<T> = NoMap> {
  on<K>(eventName: KeyOf<K, T>, listener: Listener1<K, T>): this
  onKey<K extends keyof T>(eventName: K, listener: Listener1<K, T>): this
}
type DoorEvents = { open: [name: string]; close: []; both: [a: number, b?: boolean] }
declare const door: Emitter<DoorEvents>
declare const anyEvents: Emitter
door.on('open', name => void name)
door.onKey('open', name => void name)
door.on('both', (a, b) => void [a, b])
door.on('other', (...rest) => void rest)
anyEvents.on('x', a => void a)
declare function roomForLiteral<K>(k: K | 'a' | 'b'): { k: K }
declare function noRoom<K>(k: K): { k: K }
declare function roomInUnion<K>(k: K | number): { k: K }
export const literalArguments = [roomForLiteral('a'), roomForLiteral('z'), noRoom('a'), roomInUnion('a'), roomInUnion(1)] as const
export declare const optionalElements: { t: [a: number, b?: boolean]; u: [string?]; v: [x?: 'a' | 'b', ...rest: number[]] }
export function readsOptionalElements(t: [a: number, b?: boolean]) {
  const [a, b] = t
  return [a, b, t[1], t.length] as const
}

type Choice<T> = { label: string; value: T }
type ChooserProps<T> = {
  options: Choice<T>[]
  defaultValue?: T
  onChange?: (value: T) => void
  render?: (o: Choice<T>, index: number) => string
}
declare function choose<T>(props: ChooserProps<T>): T
declare function produce<T>(o: { make: () => T; use: (t: T) => void }): T
declare function chained<A, B>(o: { a: (n: number) => A; b: (a: A) => B; c: (b: B) => void }): [A, B]
declare function nestedParts<T>(o: { data: { items: T[] }; on: { each: (t: T) => void } }): T
type StopSignal = { stopped: boolean }
declare function element<P extends {}>(type: (props: P) => void, props?: ({ key?: string } & P) | null): P
declare function Button(props: { label?: string; onClick?: (e: { x: number }) => void; signal?: StopSignal }): void
const letterChoices = [{ label: 'a', value: 'x' as const }, { label: 'b', value: 'y' as const }]
export function siblingsInform(signal: StopSignal | undefined) {
  return [
    choose({ options: letterChoices, onChange: choice => void choice }),
    choose({ options: [{ label: 'n', value: 1 }], onChange: n => void n, render: (o, i) => o.label + i }),
    choose({ onChange: c => void c, options: letterChoices }),
    choose({ ...{ options: letterChoices }, onChange: c => void c }),
    produce({ make: () => 1, use: t => void t }),
    produce({ make() { return 'a' }, use(t) { void t } }),
    chained({ a: n => String(n), b: a => a.length, c: b => void b }),
    nestedParts({ data: { items: [1, 2] }, on: { each: t => void t } }),
    element(Button, { label: 'x', ...(signal !== undefined && { signal }), onClick: click => void click.x }),
  ] as const
}

type OnlyLiteral<S extends string> = string extends S ? never : S
type SafeText = string & { __safe: true }
declare function fromLiteral<S extends string>(s: OnlyLiteral<S>): SafeText
declare function plainGeneric<S extends string>(s: S): SafeText
declare function takesNever(s: never): SafeText
export declare const rets: { a: ReturnType<typeof fromLiteral>; b: ReturnType<typeof plainGeneric>; c: ReturnType<typeof takesNever>; p: Parameters<typeof fromLiteral> }
export function declaredByReturnType(x: boolean): ReturnType<typeof fromLiteral> {
  return fromLiteral(x ? 'a' : 'b')
}
interface SqlQuery<T> extends Promise<T> { raw(): string }
declare function sqlTag<T = any>(strings: TemplateStringsArray, ...values: unknown[]): SqlQuery<T>
declare function tagInfer<V>(strings: TemplateStringsArray, ...values: V[]): V
declare function tagPlain(strings: TemplateStringsArray, n: number): { n: number }
export async function tagged(id: number) {
  const rows = await sqlTag`select ${id}`
  const typed = await sqlTag<{ id: number }[]>`select ${id}`
  const q = sqlTag`x`
  return [rows, typed, q, tagInfer`a${1}b${'x'}`, tagPlain`n${1}`] as const
}
export function anyAndTypeof(value: any, target: object, u: unknown) {
  const f = typeof value === 'function' ? value.bind(target) : value
  const s = typeof value === 'string' ? value : 0
  const o = typeof value === 'object' ? value : 0
  const uf = typeof u === 'function' ? u : 0
  return [f, s, o, uf] as const
}
type Animal = { name: string }
type Dog = { name: string; bark(): void }
type Is<A, B> = A extends B ? { yes: 1 } : { no: 1 }
interface ByMethod<T> { take(x: T): void }
interface ByProperty<T> { take: (x: T) => void }
interface CallbackMethod<T> { add(cb: () => T): void; each(cb: (x: T) => void): void }
interface CallbackProperty<T> { add: (cb: () => T) => void }
export declare const variance: [
  Is<(x: Animal) => void, (x: Dog) => void>,
  Is<(x: Dog) => void, (x: Animal) => void>,
  Is<ByMethod<Dog>, ByMethod<Animal>>,
  Is<ByMethod<Animal>, ByMethod<Dog>>,
  Is<ByProperty<Dog>, ByProperty<Animal>>,
  Is<ByProperty<Animal>, ByProperty<Dog>>,
  Is<CallbackMethod<Dog>, CallbackMethod<Animal>>,
  Is<CallbackMethod<Animal>, CallbackMethod<Dog>>,
  Is<CallbackProperty<Dog>, CallbackProperty<Animal>>,
  Is<CallbackProperty<Animal>, CallbackProperty<Dog>>,
  Is<(x: never) => 1, (...args: any[]) => any>,
  Is<(x: never) => 1, (...args: any) => unknown>,
  Is<(x: never) => 1, (...args: any) => number>,
  Is<(a: number, b?: string) => void, (a: number, b: string | undefined) => void>,
]
declare function withDefault(a: number, b = 'x', c?: boolean): void
export declare const defaultsFromOutside: [Parameters<typeof withDefault>, Parameters<typeof withDefault>[1]]

// `infer` inside a mapped type belongs to the conditional type, not to the mapped type.
interface InferSrc { check: Promise<1>; run: string }
type InMapped1<D, K extends string, F> = D extends { [key in K]: infer R } ? R : F
type InMapped2<D, F> = D extends { [key in 'check']: infer R } ? R : F
type InMapped3<D, K extends string, F> = D extends { m(): { [key in K]: () => infer R } } ? R : F
type MadeReturn<D, K extends string, F> = D extends { make(deps: never): { [key in K]: (...args: never[]) => infer R } } ? R : F
type MadeInput<D, K extends string, F> = D extends { make(deps: never): { [key in K]: (input: infer I, ...rest: never) => unknown } } ? I : F
interface MadeDef { make(d: number): { run(x: string): void; check(a: { p: 1 }): Promise<1> } }
declare const inMapped: [
  InMapped1<InferSrc, 'check', 'no'>,
  InMapped1<InferSrc, 'absent', 'no'>,
  InMapped2<InferSrc, 'no'>,
  InMapped3<{ m(): { check(): 5 } }, 'check', 'no'>,
  MadeReturn<MadeDef, 'check', 'fallback'>,
  MadeReturn<MadeDef, 'other', 'fallback'>,
  MadeInput<MadeDef, 'check', 'fallback'>,
]
export const [im1, im2, im3, im4, im5, im6, im7] = inMapped

// A type parameter that has to be known before everything has been seen loses its literals.
declare const settledItems: { name: string }[]
export const settledTotal = settledItems.reduce((a, b) => a + b.name.length, 0)
export const settledIsOne = { is: settledTotal }
declare function settledBy<T>(x: T, f: (t: T) => void): T
declare function notSettled<T>(x: T): T
export const settledPair = { a: settledBy(0, t => {}), b: notSettled(0) }

// What is expected of the result of a call says what its literal arguments are meant as.
type ExpAB = 'a' | 'b'
export const exp1: Set<ExpAB> = new Set(['a'])
export const exp2: ReadonlySet<ExpAB> = new Set(['a', 'b'])
export const exp3: ReadonlyMap<'k', 1 | 2> = new Map([['k', 1]])
export const exp4: Promise<ExpAB> = Promise.resolve('a')
export const exp5: readonly ExpAB[] = Array.from(['a'])
declare function expBox<T>(x: T): { value: T }
interface ExpWide<T> { value: T; extra?: number }
export const exp6: { value: ExpAB } = expBox('a')
export const exp7: ExpWide<ExpAB> = expBox('a')
export const expInner = [new Set(['a']), expBox('a'), Promise.resolve('a')] as const
interface ExpModel { a: Readonly<{ x: string }>; b: Readonly<{ n: number; m: number }>; c: readonly string[] }
export const expModel: ExpModel = { a: Object.freeze({ x: 'x' }), b: Object.freeze({ n: 0, m: 0 }), c: Object.freeze([]) }
type ExpResult<T> = { ok: true; value: T } | { ok: false }
declare function expOk<T>(value: T): { ok: true; value: T }
export function expBool(): ExpResult<boolean> { return expOk(false) }
export function expLit(): ExpResult<ExpAB> { return expOk('a') }
export function expNum(): ExpResult<number> { return expOk(1) }
export function expMixed(): ExpResult<boolean | 'a'> { return expOk(true) }
declare function expRo<T>(o: T): Readonly<T>
export const expViaRo: Readonly<{ x: string }> = expRo({ x: 'x' })

// The type parameter of a method, and that of the same method of what it returns.
type ThenK = { k: 'a' } | { k: 'b' }
declare const thenSt: Promise<{ d: boolean }>
export const then1: Promise<ThenK> = thenSt.then(s => ({ k: 'a' }))
export const then2: PromiseLike<ThenK> = thenSt.then(s => ({ k: 'a' }))
interface ThenP<T> { then<R1 = T>(f: (v: T) => R1): ThenP<R1> }
interface ThenL<T> { then<R1 = T>(f: (v: T) => R1): ThenL<R1> }
declare const thenP: ThenP<number>
export const then3: ThenL<ThenK> = thenP.then(s => ({ k: 'a' }))
export async function then4(k: 'file' | 'dir' | 'link') {
  if (k === 'link') k = await thenSt.then(s => (s.d ? 'dir' : 'file'), () => 'file')
  return { k }
}
export async function then5(): Promise<ThenK> { return thenSt.then(s => ({ k: 'b' })) }
// Through two calls.
type NestItem = { kind: 'a'; v: number } | { kind: 'b'; s: string }
export async function nest1(xs: number[]): Promise<NestItem[]> { return Promise.all(xs.map(async x => ({ kind: 'a', v: x }))) }
export function nest2(xs: number[]): Record<string, NestItem> { return Object.fromEntries(xs.map(x => ['k', { kind: 'a', v: x }])) }
export function nest3(xs: number[]): Map<string, NestItem> { return new Map(xs.map(x => ['k', { kind: 'a', v: x }])) }
interface NestOut { code: number | null; text: string }
export async function nest4(): Promise<NestOut> { return new Promise((resolve, reject) => { resolve({ code: 1, text: '' }) }) }
export async function nest5(): Promise<NestOut | undefined> { return await new Promise(resolve => { resolve(undefined) }) }
// Generic mapped types.
export function gm1<T extends object>(obj: T): Partial<T> {
  const out: Partial<T> = {}
  for (const k in obj) out[k] = obj[k]
  return out
}
export function gm2<T>(x: T): Readonly<T> { return x }
export function gm3<T, K extends keyof T>(x: T): Pick<T, K> { return x }
export function gm4<T>(x: Readonly<T>): T { return x }
