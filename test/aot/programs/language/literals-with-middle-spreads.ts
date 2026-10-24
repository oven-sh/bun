// Object literals with spreads in the middle, of values that are false, undefined or objects.
function build(flag: boolean, list: string[], extra?: { allow: string[]; deny: string[] }) {
  const restricted = flag ? "r" : undefined
  return {
    mode: "m",
    allow: { cli: flag ? [] : list, ...(extra && { session: flag ? [] : extra.allow }) },
    deny: { cli: list, ...(extra && { session: extra.deny }), ...(list.length > 0 && { narrowing: list }) },
    ask: {},
    overrides: {},
    ...(restricted && { restricted }),
    ...(flag && { on: true }),
    available: flag,
    ...((gate: boolean) => ({ auto: gate, can: gate }))(flag),
    last: 1,
  }
}
function keysOf(o: object) { return Object.keys(o).join() }
for (const flag of [true, false]) {
  for (const extra of [undefined, { allow: ["a"], deny: ["d"] }]) {
    const made = build(flag, ["x"], extra)
    console.log(keysOf(made), "|", keysOf(made.allow), "|", keysOf(made.deny), "|", made.deny.cli.join(), JSON.stringify(made))
  }
}
function through(context: ReturnType<typeof build>, updates: string[]) {
  let now = context
  for (const update of updates) now = { ...now, mode: update }
  return now
}
const after = through(build(false, []), [])
for (const key of ["cli", "session"]) console.log(String((after.deny as any)[key]), String((through(build(true, ["q"]), ["u"]).deny as any)[key]))
// A literal that is held to a type it has only some of the required properties of.
interface Whole { a: number; b: { x: number }; c: string; d?: number }
function whole(flag: boolean): Whole {
  return { a: 1, b: { x: 2 }, c: "c", ...((gate: boolean): { c?: string } => ({ c: gate ? "yes" : "no" }))(flag) }
}
function part(): Whole { return { ...whole(true), ...((): Partial<Whole> => ({ a: 5 }))() } }
console.log(JSON.stringify(whole(true)), JSON.stringify(part()), Object.keys(part()).join())
// What lacks required properties for good and is said to be a `Whole`, by `any` or `as`: type-rules/object-missing-required-properties.
const narrowed = ((): Partial<Whole> => ({ c: "only" }))()
console.log(Object.keys(narrowed).join(), JSON.stringify({ a: 0, b: { x: 9 }, ...narrowed }))
