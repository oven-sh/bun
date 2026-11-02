// Whatever else is done with a standard stream finds the stream of node:tty or node:fs, as in plain Bun.
const { stdout, stderr, stdin } = process;
const util = require("node:util");
console.log(
  Object.keys(stdout).length > 3,
  Object.getPrototypeOf(stdout).constructor.name,
  "on" in stdout,
  Reflect.has(stdin, "read"),
);
console.log(
  stdout instanceof require("node:stream").Writable,
  stdout instanceof require("node:events"),
  stdin instanceof require("node:stream").Readable,
);
console.log(util.types.isProxy(stdout), util.types.isProxy(stderr), util.types.isProxy(stdin));
console.log(
  Object.prototype.toString.call(stdout),
  `${stderr}`,
  stdout == 1,
  Object.isExtensible(stdout),
  Object.isFrozen(stdin),
);
console.log(
  JSON.stringify(Object.getOwnPropertyDescriptor(stdout, "fd")),
  typeof Object.getOwnPropertyDescriptor(stdout, "write")?.value,
);
console.log(
  stdout.writable,
  stdout.writableLength,
  stdout.destroyed,
  stdout.readable,
  typeof stdout._type,
  stdout.columns === stderr.columns,
);
console.log(
  console._stdout === stdout,
  console._stderr === stderr,
  typeof stdout[Symbol.asyncIterator] === typeof stderr[Symbol.asyncIterator],
);
console.log(util.inspect(stdout, { depth: 0 }).slice(0, 12), Bun.inspect(stdin, { depth: 0 }).slice(0, 11));
stdout.mine = 1;
Object.defineProperty(stderr, "mine", { value: 2, configurable: true });
console.log(stdout.mine, stderr.mine, delete stdout.mine, delete stderr.mine, stdout.mine, stderr.mine);
const seen = [];
const write = stdout.write;
stdout.write = chunk => (seen.push(chunk), true);
stdout.write("hidden\n");
stdout.write = write;
stdout.write("shown " + seen.length + "\n");
try {
  write("without a receiver\n");
} catch (error) {
  console.log(error.name);
}
console.log(write.call(stderr, "") === true, write.bind(stdout)("bound\n"), write.apply(stdout, ["applied\n"]));
stdout.once("drain", () => {});
console.log(stdout.listenerCount("drain"), stdin.isPaused(), stdin.listenerCount("data"));
