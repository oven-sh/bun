// A read-only data property arrives on the prototype under the name of an optional field.
// In strict code a store to an instance without the field throws a TypeError and leaves the slot empty; defining the field still works.
// In this twin the class declares only what its constructor stores: the other fields are added late, through a cast to an interface.
interface OptionsShape {
  name: string;
  depth?: number;
}
const Options = class {
  declare name: string;
  constructor(name: string) {
    this.name = name;
  }
};
function read(options: OptionsShape) {
  return options.depth;
}
function write(options: OptionsShape, value: number) {
  options.depth = value;
}
function attempt(run: () => unknown) {
  try {
    return String(run());
  } catch (error) {
    return (error as Error).constructor.name;
  }
}
function describe(options: OptionsShape) {
  return `${read(options)} ${"depth" in options} ${Object.hasOwn(options, "depth")} [${Object.keys(options)}]`;
}

let sum = 0;
for (let i = 0; i < 3000; i++) {
  const options = new Options("o") as OptionsShape;
  sum += read(options) ?? 1;
  write(options, i & 7);
  sum += read(options)!;
}
console.log("warm", sum);

const empty = new Options("empty") as OptionsShape;
const filled = new Options("filled") as OptionsShape;
write(filled, 2);
Reflect.defineProperty(Options.prototype, "depth", { value: 9, writable: false, enumerable: true, configurable: true });
const fresh = new Options("fresh") as OptionsShape;
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
console.log("writable now:", attempt(() => write(fresh, 13)), describe(fresh), describe((new Options("n") as OptionsShape)));
delete (Options.prototype as any).depth;
console.log("gone again:", describe((new Options("n") as OptionsShape)), attempt(() => write((new Options("n") as OptionsShape), 1)));
