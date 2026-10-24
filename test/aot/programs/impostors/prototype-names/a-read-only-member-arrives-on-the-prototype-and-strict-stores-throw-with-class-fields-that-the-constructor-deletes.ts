// A read-only data property arrives on the prototype under the name of an optional field.
// In strict code a store to an instance without the field throws a TypeError and leaves the slot empty; defining the field still works.
// In this twin the optional fields are class fields without `declare`: they are defined at birth and the constructor deletes them, so the slots are declared and empty. Every instance may reach unknown code.
const unknownCodeRuns = process.argv.length > 99;
function handOver(value: object) {
  if (unknownCodeRuns) (globalThis as any).hook?.(value);
}
class Options {
  declare name: string;
  depth?: number;
  constructor(name: string) {
    delete this.depth;
    handOver(this);
    this.name = name;
  }
}
function read(options: Options) {
  return options.depth;
}
function write(options: Options, value: number) {
  options.depth = value;
}
function attempt(run: () => unknown) {
  try {
    return String(run());
  } catch (error) {
    return (error as Error).constructor.name;
  }
}
function describe(options: Options) {
  return `${read(options)} ${"depth" in options} ${Object.hasOwn(options, "depth")} [${Object.keys(options)}]`;
}

let sum = 0;
for (let i = 0; i < 3000; i++) {
  const options = new Options("o");
  sum += read(options) ?? 1;
  write(options, i & 7);
  sum += read(options)!;
}
console.log("warm", sum);

const empty = new Options("empty");
const filled = new Options("filled");
write(filled, 2);
Reflect.defineProperty(Options.prototype, "depth", { value: 9, writable: false, enumerable: true, configurable: true });
const fresh = new Options("fresh");
console.log("read-only:", describe(empty), "|", describe(filled), "|", describe(fresh));
console.log(
  "stores:",
  attempt(() => write(empty, 1)),
  attempt(() => write(filled, 3)),
  attempt(() => write(fresh, 4)),
  attempt(() => (empty.depth! += 1)),
  attempt(() => empty.depth!++),
  attempt(() => (empty.depth ??= 5)),
  attempt(() => (empty.depth ||= 5)),
  attempt(() => (empty.depth &&= 5)),
  attempt(() => Reflect.set(empty, "depth", 6)),
  attempt(() => Object.assign(fresh, { depth: 7 })),
);
console.log("after:", describe(empty), "|", describe(filled), "|", describe(fresh));
Object.defineProperty(empty, "depth", { value: 11, writable: true, enumerable: true, configurable: true });
console.log("defined on the instance:", describe(empty), attempt(() => write(empty, 12)), describe(empty));
Object.defineProperty(Options.prototype, "depth", { writable: true });
console.log("writable now:", attempt(() => write(fresh, 13)), describe(fresh), describe(new Options("n")));
delete (Options.prototype as any).depth;
console.log("gone again:", describe(new Options("n")), attempt(() => write(new Options("n"), 1)));
