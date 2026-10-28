// Prints the own properties and the text of functions of Buffer, Bun, console, process and two modules. Each comes out of its property descriptor.
const describe = fn => {
  if (typeof fn !== "function") return typeof fn;
  const properties = Reflect.ownKeys(fn).map(key => {
    const { value, writable, enumerable, configurable } = Reflect.getOwnPropertyDescriptor(fn, key);
    return [
      String(key),
      typeof value === "function" || typeof value === "object" ? typeof value : value,
      writable,
      enumerable,
      configurable,
    ];
  });
  return JSON.stringify([properties, Function.prototype.toString.call(fn)]);
};
const holders = {
  Buffer,
  "Buffer.prototype": Buffer.prototype,
  Bun,
  "Bun.peek": Bun.peek,
  "Bun.Glob.prototype": Bun.Glob.prototype,
  console,
  process,
  "node:console": require("node:console"),
  "node:module": require("node:module"),
};
const members = [
  ["Buffer", "alloc"],
  ["Buffer", "from"],
  ["Buffer", "isBuffer"],
  ["Buffer.prototype", "toJSON"],
  ["Buffer.prototype", "write"],
  ["Bun", "file"],
  ["Bun", "peek"],
  ["Bun.peek", "status"],
  ["Bun.Glob.prototype", "match"],
  ["Bun.Glob.prototype", "scan"],
  ["Bun.Glob.prototype", "scanSync"],
  ["console", "log"],
  ["console", "write"],
  ["console", Symbol.asyncIterator],
  ["process", "cwd"],
  ["process", "loadEnvFile"],
  ["process", "_rawDebug"],
  ["node:console", "write"],
  ["node:module", "_initPaths"],
];
for (const [holder, key] of members)
  console.log(holder, String(key), describe(Object.getOwnPropertyDescriptor(holders[holder], key)?.value));
