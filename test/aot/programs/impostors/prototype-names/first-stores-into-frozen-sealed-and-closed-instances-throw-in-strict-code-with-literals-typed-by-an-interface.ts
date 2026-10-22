// The slot of a declared optional field is there from birth, but the property is not: an instance that is frozen, sealed or not extensible may not get it.
// In strict code the first store throws a TypeError and the slot must stay empty. A field that was filled before is another matter: sealed and closed instances still take stores to it.
// In this twin the objects are literals typed by an interface: the optional fields are declared, and their slots are empty from birth. Every object may reach unknown code.
const unknownCodeRuns = process.argv.length > 99;
function handOver(value: object) {
  if (unknownCodeRuns) (globalThis as any).hook?.(value);
}
interface Config {
  id: number;
  mode?: string;
  level?: number;
}
function makeConfig(id: number): Config {
  const made: Config = { id };
  handOver(made);
  return made;
}
interface Plain {
  id: number;
  mode?: string;
  level?: number;
}
function setMode(config: Config, value: string) {
  config.mode = value;
}
function setLevel(config: Config, value: number) {
  config.level = value;
}
function setModeOfPlain(plain: Plain, value: string) {
  plain.mode = value;
}
function orDefault(config: Config) {
  return (config.level ??= 5);
}
function bump(config: Config) {
  return config.level!++;
}
function attempt(run: () => unknown) {
  try {
    return "ok " + run();
  } catch (error) {
    return (error as Error).constructor.name;
  }
}
function state(object: Plain) {
  return `${object.mode} ${object.level} ${"mode" in object} ${Object.hasOwn(object, "mode")} [${Object.keys(object)}] ${JSON.stringify(object)}`;
}
const closers: [string, <T extends object>(object: T) => T][] = [
  ["open", object => object],
  ["frozen", Object.freeze],
  ["sealed", Object.seal],
  ["not extensible", Object.preventExtensions],
  ["closed by Reflect", object => (Reflect.preventExtensions(object), object)],
];

let count = 0;
for (let i = 0; i < 3000; i++) {
  const config = makeConfig(i);
  if (i % 5 === 0) Object.preventExtensions(config);
  if (attempt(() => setMode(config, "m")) === "TypeError") count++;
  if (Object.hasOwn(config, "mode")) count += 10;
}
console.log("warm", count);

for (const [label, close] of closers) {
  const empty = close(makeConfig(1));
  const half = makeConfig(2);
  setMode(half, "before");
  close(half);
  const literal = close<Plain>({ id: 3 });
  const literalHalf = close<Plain>({ id: 4, mode: "before" });
  console.log(label);
  console.log("  empty:", attempt(() => setMode(empty, "a")), attempt(() => setLevel(empty, 1)), attempt(() => orDefault(empty)), attempt(() => bump(empty)), "|", state(empty));
  console.log("  half:", attempt(() => setMode(half, "b")), attempt(() => setLevel(half, 2)), "|", state(half));
  console.log("  a literal:", attempt(() => setModeOfPlain(literal, "c")), "|", state(literal));
  console.log("  a literal with the field:", attempt(() => setModeOfPlain(literalHalf, "d")), "|", state(literalHalf));
  console.log("  other ways:", attempt(() => Reflect.set(empty, "mode", "e")), attempt(() => Object.assign(empty, { mode: "f" })), attempt(() => Object.defineProperty(empty, "mode", { value: "g" })), attempt(() => delete half.mode), "|", state(empty), "|", state(half));
}
