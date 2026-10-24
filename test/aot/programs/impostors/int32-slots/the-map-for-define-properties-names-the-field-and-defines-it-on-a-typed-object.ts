// `Object.defineProperties(target, { id: { get, set } })`: the literal has a member called `id`, which holds a descriptor and is no store of a number into any field called id.
// But what it describes is one: the target is an instance whose `id` is a number field. The descriptors define fractions, -0 and NaN as values, accessors that answer them, and read-only and hidden numbers.
const unknownCodeRuns = process.argv.length > 99;
function handOver(value: object) {
  if (unknownCodeRuns) (globalThis as any).hook?.(value);
}
const odd: number[] = (
  JSON.parse(
    '["0.5","-0.5","-0","NaN","Infinity","-Infinity","2147483647","2147483648","-2147483643","-2147483644","-2147483645","-2147483646","-2147483647","-2147483648","-2147483649","4294967295","4294967296","1e21","5e-324","9007199254740993"]'
      .split("")
      .join(""),
  ) as string[]
).map(Number);
function exact(value: unknown): string {
  if (typeof value !== "number") return `${typeof value}:${String(value)}`;
  return `${Object.is(value, -0) ? "-0" : value}${Number.isInteger(value) ? "" : "~"}`;
}
class Entity { id = 0; rank = 0; }
function idOf(entity: Entity) {
  return entity.id;
}
function setId(entity: Entity, id: number) {
  entity.id = id;
}
function bump(entity: Entity) {
  entity.id += 1;
  entity.rank++;
}
function fresh() {
  const made = new Entity();
  handOver(made);
  return made;
}
function show(entity: Entity) {
  return `${exact(idOf(entity))} ${exact(entity.rank)} ${JSON.stringify(entity)} [${Object.keys(entity)}] ${JSON.stringify(Object.getOwnPropertyDescriptor(entity, "id"), (_, item) => (typeof item === "number" ? exact(item) : typeof item === "function" ? "f" : item))}`;
}
function attempt(run: () => void) {
  try {
    run();
    return "done";
  } catch (error) {
    return (error as Error).constructor.name;
  }
}
const log: string[] = [];
function asValue(entity: Entity, value: number) {
  Object.defineProperties(entity, { id: { value, writable: true, enumerable: true, configurable: true }, rank: { value } });
}
function asAccessors(entity: Entity, value: number) {
  let kept = value;
  Object.defineProperties(entity, {
    id: {
      get() { return kept; },
      set(next: number) { log.push("set " + exact(next)); kept = next; },
      enumerable: true,
      configurable: true,
    },
  });
}
function asReadOnly(entity: Entity, value: number) {
  Object.defineProperties(entity, { id: { value, writable: false } });
}
function asHidden(entity: Entity, value: number) {
  Object.defineProperties(entity, { id: { value, enumerable: false } });
}
function onSomethingElse() {
  return Object.defineProperties({}, { id: { get() { return 0.5; }, enumerable: true }, rank: { value: 1.5, enumerable: true } });
}
let sum = 0;
for (let i = 0; i < 2000; i++) {
  const entity = fresh();
  setId(entity, i & 63);
  bump(entity);
  sum += idOf(entity) + entity.rank;
}
console.log("warm", sum, JSON.stringify(onSomethingElse()));
for (const [label, define] of [["a value", asValue], ["accessors", asAccessors], ["read-only", asReadOnly], ["hidden", asHidden]] as [string, (entity: Entity, value: number) => void][]) {
  console.log(label + ":");
  for (const value of odd) {
    const entity = fresh();
    define(entity, value);
    const defined = show(entity);
    const bumped = attempt(() => bump(entity));
    const after = show(entity);
    const stored = attempt(() => setId(entity, 4));
    console.log(`  ${exact(value)}: ${defined} | ${bumped} ${after} | ${stored} ${exact(idOf(entity))} ${log.join()}`);
    log.length = 0;
  }
}
