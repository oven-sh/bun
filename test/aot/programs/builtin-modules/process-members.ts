// `process.env`, `process.stdout`, `process.version` and their like are read behind a watch where the read is hot: replaced, deleted or made getters, what is read is what is there now.
const world = globalThis as any;
const own = process as any;
function environment(rounds: number): unknown {
  let seen: unknown;
  for (let i = 0; i < rounds; i++) seen = process.env;
  return seen;
}
function variable(rounds: number): string {
  let seen = "";
  for (let i = 0; i < rounds; i++) seen = String(process.env.MEMBERS_OF_PROCESS);
  return seen;
}
function byKey(key: string, rounds: number): string {
  let seen = "";
  for (let i = 0; i < rounds; i++) seen = String(process.env[key]);
  return seen;
}
function version(rounds: number): string {
  let seen = "";
  for (let i = 0; i < rounds; i++) seen = String(process.version);
  return seen;
}
function streams(rounds: number): string {
  let seen = "";
  for (let i = 0; i < rounds; i++) seen = typeof process.stdout + " " + typeof process.stderr + " " + typeof process.stdin + " " + typeof process.stdout.write;
  return seen;
}
function others(rounds: number): string {
  let seen = "";
  for (let i = 0; i < rounds; i++) seen = [typeof process.pid, typeof process.versions, typeof process.versions.bun, typeof process.execPath, typeof process.argv, process.argv.length > 0, typeof process.exitCode, typeof process.title, typeof process.release.name, typeof process.features, typeof process.config, typeof process.nextTick, typeof process.hrtime, typeof process.cwd, typeof process.on, typeof process.emit, typeof own.isBun, typeof own.notThere].join();
  return seen;
}
function ofBun(rounds: number): string {
  let seen = "";
  for (let i = 0; i < rounds; i++) seen = [typeof Bun.env, Bun.env === process.env, typeof Bun.version, typeof Bun.main, typeof Bun.argv, typeof Bun.file, typeof performance.now, typeof performance.timeOrigin, typeof navigator.userAgent, typeof crypto.subtle].join();
  return seen;
}
function commandLine(rounds: number): unknown {
  let seen: unknown;
  for (let i = 0; i < rounds; i++) seen = process.argv;
  return seen;
}
const originalArguments = process.argv;
console.log("argv", commandLine(5000) === originalArguments, Array.isArray(originalArguments));
process.argv = ["replaced"];
console.log("argv", JSON.stringify(commandLine(3)));
process.argv = originalArguments;
console.log("argv", commandLine(3) === originalArguments);
const originalEnvironment = process.env;
const originalVersion = process.version;
console.log("warm", environment(5000) === originalEnvironment, variable(5000), byKey("MEMBERS_OF_PROCESS", 5000), version(5000) === originalVersion, streams(5000));
console.log(others(5000));
console.log(ofBun(5000));

process.env.MEMBERS_OF_PROCESS = "set";
console.log("set", variable(3), byKey("MEMBERS_OF_PROCESS", 3), environment(3) === originalEnvironment);
delete process.env.MEMBERS_OF_PROCESS;
console.log("deleted", variable(3), byKey("MEMBERS_OF_PROCESS", 3));

own.env = { MEMBERS_OF_PROCESS: "of another object" } as any;
console.log("another env", environment(3) === originalEnvironment, variable(3), byKey("MEMBERS_OF_PROCESS", 3), byKey("HOME", 3));
let asked = 0;
own.env = new Proxy(originalEnvironment, { get: (target: any, key) => (asked++, key === "MEMBERS_OF_PROCESS" ? "by a proxy" : target[key]) });
console.log("a proxy", variable(3), byKey("MEMBERS_OF_PROCESS", 3), asked);
own.env = originalEnvironment;
console.log("the first again", environment(3) === originalEnvironment, variable(3));

let read = 0;
Object.defineProperty(process, "version", { get: () => "read " + ++read, configurable: true });
console.log("a getter", version(3), read);
Object.defineProperty(process, "version", { value: "v0.0.0", writable: true, configurable: true, enumerable: true });
console.log("a value", version(3));
own.version = originalVersion;
console.log("the first again", version(3) === originalVersion);

const originalStdout = Object.getOwnPropertyDescriptor(process, "stdout")!;
Object.defineProperty(process, "stdout", { value: { write: 5 } as any, configurable: true, writable: true });
const withAnotherStdout = streams(3);
Object.defineProperty(process, "stdout", originalStdout);
console.log("another stdout", withAnotherStdout, "|", streams(3));

own.notThere = "there now";
console.log(others(3).endsWith("string"));
delete own.notThere;
console.log(others(3).endsWith("undefined"));

Bun.gc(true);
console.log("after a collection", environment(5000) === originalEnvironment, version(5000) === originalVersion, streams(5000), others(50) === others(1), ofBun(50) === ofBun(1));
export {};
