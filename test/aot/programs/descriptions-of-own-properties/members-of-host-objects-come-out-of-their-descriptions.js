// A member of an object of the host that is described under a key from enumeration is used: what comes out under `value` or `get` works like the member itself.
// Not so on Bun: a key that is put together at run time names no member of Bun. So this program also calls the one of them that is written in JavaScript by its name.
let functions = 0;
let getters = 0;
let others = 0;
const failures = [];
for (const [name, holder] of [["Bun", Bun], ["process", process], ["console", console], ["Buffer", Buffer], ["Math", Math]]) {
  for (const key of Object.getOwnPropertyNames(holder)) {
    const descriptor = Object.getOwnPropertyDescriptor(holder, key);
    if (!descriptor) {
      failures.push(name + "." + key + " has no description");
      continue;
    }
    if (descriptor.get) getters++;
    else if (typeof descriptor.value === "function") functions++;
    else others++;
  }
}
console.log(functions > 100, getters >= 0, others > 10, failures.join());
const take = (holder, key) => Reflect.getOwnPropertyDescriptor(holder, key).value;
const names = process.argv.length > 100 ? [] : ["peek", "inspect", "deepEquals", "nanoseconds", "escapeHTML", "stringWidth"];
if (Bun.peek(Promise.resolve(4)) !== 4) failures.push("Bun.peek");
const taken = Object.fromEntries(names.map(name => [name, take(Bun, name)]));
console.log(taken.peek(Promise.resolve(4)), taken.inspect({ a: 1 }), taken.deepEquals([1], [1]), typeof taken.nanoseconds(), taken.escapeHTML("<a>"), taken.stringWidth("four"));
const ofProcess = process.argv.length > 100 ? [] : ["cwd", "hrtime", "uptime", "memoryUsage", "emitWarning", "nextTick"];
for (const name of ofProcess) console.log(name, typeof take(process, name));
console.log(typeof take(process, "cwd").call(process), typeof take(process, "hrtime").bigint(), typeof take(process, "memoryUsage")().rss);
take(process, "nextTick")(() => console.log("the tick has come"));
const streams = process.argv.length > 100 ? [] : ["stdout", "stderr", "stdin"];
for (const name of streams) {
  const descriptor = Object.getOwnPropertyDescriptor(process, name);
  const stream = descriptor.get ? descriptor.get.call(process) : descriptor.value;
  console.log(name, typeof stream.on, stream.fd);
}
console.log(take(Math, "max")(1, 2), take(console, "log") === console.log, take(Buffer, "from")("hi").toString("hex"));
