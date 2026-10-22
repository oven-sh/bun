// No name arrives here: the prototype has its defaults from the start, in plain sight. Object.freeze changes their attributes only,
// and from then on a first store into an instance throws in strict code. A frozen prototype also refuses new names and a new link, so the other optional field stays absent.
// In this twin the optional fields are class fields without `declare`: they are defined at birth and the constructor deletes them, so the slots are declared and empty. Every instance may reach unknown code.
const unknownCodeRuns = process.argv.length > 99;
function handOver(value: object) {
  if (unknownCodeRuns) (globalThis as any).hook?.(value);
}
class Options {
  declare id: number;
  depth?: number;
  color?: string;
  constructor(id: number) {
    delete this.depth;
    delete this.color;
    handOver(this);
    this.id = id;
  }
}
Options.prototype.depth = 3;
function depthOf(options: Options) {
  return options.depth;
}
function setDepth(options: Options, value: number) {
  options.depth = value;
}
function colorOf(options: Options) {
  return options.color;
}
function setColor(options: Options, value: string) {
  options.color = value;
}
function attempt(run: () => unknown) {
  try {
    run();
    return "done";
  } catch (error) {
    return (error as Error).constructor.name;
  }
}
function state(options: Options) {
  return `${depthOf(options)} ${colorOf(options)} [${Object.keys(options)}]`;
}

let sum = 0;
for (let i = 0; i < 3000; i++) {
  const options = new Options(i);
  sum += depthOf(options)! + (colorOf(options)?.length ?? 1);
  if (i & 1) setDepth(options, 4);
  if (i & 2) setColor(options, "red");
  sum += depthOf(options)! + (colorOf(options)?.length ?? 1);
}
console.log("warm", sum);

const empty = new Options(1);
const filled = new Options(2);
setDepth(filled, 20);
Object.freeze(Object.getPrototypeOf(empty));
console.log("frozen:", state(empty), "|", state(filled), "|", state(new Options(3)));
console.log("stores of the depth:", attempt(() => setDepth(empty, 1)), attempt(() => setDepth(filled, 21)), attempt(() => setDepth(new Options(4), 1)));
console.log("stores of the color:", attempt(() => setColor(empty, "blue")), attempt(() => setColor(new Options(5), "blue")));
console.log("after:", state(empty), "|", state(filled));
console.log(
  "changes to the prototype:",
  attempt(() => ((Options.prototype as any)["col" + "or"] = "inherited")),
  attempt(() => Object.defineProperty(Options.prototype, "color", { get: () => "computed" })),
  Reflect.defineProperty(Options.prototype, "color", { value: "defined" }),
  Reflect.set(Options.prototype, "color", "set"),
  attempt(() => Object.setPrototypeOf(Options.prototype, { color: "from above" })),
  attempt(() => delete (Options.prototype as any).depth),
);
console.log("nothing came of it:", state(new Options(6)), "color" in new Options(7));
Object.defineProperty(empty, "depth", { value: 9, writable: true, enumerable: true, configurable: true });
console.log("a definition on the instance:", state(empty), attempt(() => setDepth(empty, 10)), state(empty));
