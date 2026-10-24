// A first store into an instance that is frozen, sealed or not extensible throws in strict code: the slot is there, the property may not be made.
// With a setter of that name on the prototype the same store succeeds, because nothing is added to the instance. Both orders of freezing and arriving are tried.
const log: string[] = [];
class Config {
  declare id: number;
  declare mode?: string;
  constructor(id: number) {
    this.id = id;
  }
}
function modeOf(config: Config) {
  return config.mode;
}
function setMode(config: Config, value: string) {
  config.mode = value;
}
function attempt(config: Config, value: string) {
  try {
    setMode(config, value);
    return `stored, reads ${modeOf(config)} [${Object.keys(config)}]`;
  } catch (error) {
    return `${(error as Error).constructor.name}, reads ${modeOf(config)} [${Object.keys(config)}]`;
  }
}
function four(base: number): Config[] {
  return [new Config(base), Object.freeze(new Config(base + 1)), Object.seal(new Config(base + 2)), Object.preventExtensions(new Config(base + 3))];
}
function flush() {
  const text = log.join(", ");
  log.length = 0;
  return text;
}

let length = 0;
for (let i = 0; i < 3000; i++) {
  const config = new Config(i);
  if (i % 3 === 0) Object.preventExtensions(config);
  length += attempt(config, "m").length;
}
console.log("warm", length);

const before = four(10);
console.log("no setter:", four(0).map(config => attempt(config, "a")).join(" | "));
Object.defineProperty(Object.getPrototypeOf(before[0]), "mo" + "de", {
  get() {
    return "inherited";
  },
  set(this: Config, value: string) {
    log.push(`mode = ${value} on ${this.id}`);
  },
  configurable: true,
});
console.log("closed before the setter came:", before.map(config => attempt(config, "b")).join(" | "));
console.log(flush());
console.log("closed after the setter came:", four(20).map(config => attempt(config, "c")).join(" | "));
console.log(flush());
Object.defineProperty(Config.prototype, "mode", { value: "a value", writable: true, configurable: true });
console.log("a value instead:", four(30).map(config => attempt(config, "d")).join(" | "));
delete (Config.prototype as any).mode;
console.log("gone again:", before.map(config => attempt(config, "e")).join(" | "), flush().length);
