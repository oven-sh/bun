// A CommonJS TypeScript file: the functions outside the class bodies are sloppy code, and the fields are declared all the same.
// A first store into an instance that is frozen, sealed or not extensible does nothing, says nothing, and must not fill the slot.
// In this twin the optional fields are class fields without `declare`: they are defined at birth and the constructor deletes them, so the slots are declared and empty. Every instance may reach unknown code.
const unknownCodeRuns = process.argv.length > 99;
function handOver(value: object) {
  if (unknownCodeRuns) (globalThis as any).hook?.(value);
}
class Config {
  declare id: number;
  mode?: string;
  level?: number;
  constructor(id: number) {
    delete this.mode;
    delete this.level;
    handOver(this);
    this.id = id;
  }
  strictStore(value: string) {
    this.mode = value;
  }
}
interface Plain {
  id: number;
  mode?: string;
  level?: number;
}
function setMode(config: Config, value: string) {
  config.mode = value;
  return config.mode;
}
function setLevel(config: Config, value: number) {
  config.level = value;
  return config.level;
}
function setModeOfPlain(plain: Plain, value: string) {
  plain.mode = value;
  return plain.mode;
}
function orDefault(config: Config) {
  return (config.level ??= 5);
}
function bump(config: Config) {
  return config.level!++;
}
function state(object: Plain) {
  return `${object.mode} ${object.level} ${"mode" in object} ${Object.prototype.hasOwnProperty.call(object, "mode")} [${Object.keys(object)}] ${JSON.stringify(object)}`;
}
function strictly(config: Config) {
  try {
    config.strictStore("strict");
    return "stored";
  } catch (error) {
    return (error as Error).constructor.name;
  }
}
console.log("sloppy:", (function (this: unknown) { return this !== undefined; })());
const closers: [string, <T extends object>(object: T) => T][] = [
  ["open", object => object],
  ["frozen", Object.freeze],
  ["sealed", Object.seal],
  ["not extensible", Object.preventExtensions],
];

let count = 0;
for (let i = 0; i < 3000; i++) {
  const config = new Config(i);
  if (i % 5 === 0) Object.preventExtensions(config);
  if (setMode(config, "m") === undefined) count++;
  if (Object.keys(config).length === 2) count += 10;
}
console.log("warm", count);

for (const [label, close] of closers) {
  const empty = close(new Config(1));
  const half = new Config(2);
  setMode(half, "before");
  close(half);
  const literal = close<Plain>({ id: 3 });
  console.log(label);
  console.log("  empty:", setMode(empty, "a"), setLevel(empty, 1), orDefault(empty), bump(empty), "|", state(empty));
  console.log("  half:", setMode(half, "b"), setLevel(half, 2), delete half.mode, "|", state(half));
  console.log("  a literal:", setModeOfPlain(literal, "c"), "|", state(literal));
  console.log("  a method of the class is strict:", strictly(empty), "|", state(empty));
}
