// A literal leaves out optional members of the type it is written under, and no `o.name = v` in the program stores them. They arrive all the same.
interface Options {
  host?: string;
  port?: number;
  secure?: boolean;
  ratio?: number;
  tags?: string[];
}

function describe(options: Options): string {
  return `${options.host} ${options.port} ${options.secure} ${options.ratio} ${options.tags?.join("+")} | ${Object.keys(options).join(",")}`;
}

function underComputedKey(key: string, value: unknown): Options {
  const options: Options = { host: "a" };
  (options as Record<string, unknown>)[key] = value;
  return options;
}

function byAssign(more: Options): Options {
  const options: Options = { port: 1 };
  Object.assign(options, more);
  return options;
}

function byDefinition(): Options {
  const options: Options = { secure: true };
  Object.defineProperty(options, "ratio", { value: 0.5, enumerable: true, writable: true, configurable: true });
  Object.defineProperty(options, "tags", { get: () => ["g"], enumerable: false, configurable: true });
  return options;
}

function fill(this: Options, port: number): void {
  this.port = port;
  this.ratio = port / 4;
}

function byThis(): Options {
  const options: Options = { host: "t" };
  fill.call(options, 9);
  return options;
}

function byReflection(): Options {
  const options: Options = {};
  Reflect.set(options, "tags", ["r"]);
  Reflect.set(options, "secure", false);
  return options;
}

for (let round = 0; round < 3; round++) {
  console.log(describe(underComputedKey("port", 80 + round)));
  console.log(describe(underComputedKey("tags", ["x", String(round)])));
  console.log(describe(underComputedKey("other", round)));
  console.log(describe(byAssign({ host: "h", ratio: 1.5, tags: [] })));
  console.log(describe(byAssign({})));
  console.log(describe(byDefinition()));
  console.log(describe(byThis()));
  console.log(describe(byReflection()));
}
