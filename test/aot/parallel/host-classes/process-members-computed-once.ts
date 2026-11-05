// The host makes fifteen members of `process` and nine of `Bun` at their first read, and after that only a store replaces them. Where the program stores to none of them, every read gives what the first one gave: the same number, string or object in a loop, in another function, in a closure and after a collection, and each thread has its own. `process.argv0`, `Bun.argv` and `Bun.revision` are stored to further down, so each read of those finds what is there now. The host itself puts another object under `process.env` and `Bun.env` when a Worker is started with SHARE_ENV, and the reads after that find it. This file is the only entry point of the build, so it is also the entry point of the Worker.
import { parentPort, SHARE_ENV, Worker, workerData } from "node:worker_threads";

const own = process as any;
const bun = Bun as any;

function objects(): unknown[] {
  return [process.config, process.env, process.features, process.stderr, process.stdin, process.stdout, process.versions, Bun.env, Bun.stderr, Bun.stdin, Bun.stdout];
}
function primitives(): unknown[] {
  return [process.browser, process.execPath, process.isBun, process.pid, process.revision, process.version, Bun.isMainThread, Bun.version, bun.cwd];
}
function same(left: unknown[], right: unknown[]): boolean {
  return left.length === right.length && left.every((value, index) => Object.is(value, right[index]));
}
function kinds(values: unknown[]): string {
  return values.map(value => typeof value).join();
}
function sumOfIds(rounds: number): number {
  let sum = 0;
  for (let i = 0; i < rounds; i++) sum += process.pid;
  return sum;
}
function lengthOfVersions(rounds: number): number {
  let length = 0;
  for (let i = 0; i < rounds; i++) length += process.version.length + Bun.version.length;
  return length;
}
function variable(rounds: number): string {
  let seen = "";
  for (let i = 0; i < rounds; i++) seen = String(process.env.COMPUTED_ONCE) + "/" + String(Bun.env.COMPUTED_ONCE);
  return seen;
}
function nameOfProgram(rounds: number): string {
  let seen = "";
  for (let i = 0; i < rounds; i++) seen = process.argv0;
  return seen;
}
function nameOfRelease(rounds: number): string {
  let seen = "";
  for (let i = 0; i < rounds; i++) seen = process.release.name;
  return seen;
}
function argumentsOfBun(rounds: number): unknown {
  let seen: unknown;
  for (let i = 0; i < rounds; i++) seen = Bun.argv;
  return seen;
}
function outcomeOf(work: () => void): string {
  try {
    work();
    return "stored";
  } catch (error) {
    return (error as Error).constructor.name;
  }
}

function membersNeverStoredTo(firstObjects: unknown[], firstPrimitives: unknown[]) {
  console.log("kinds", kinds(firstObjects), kinds(firstPrimitives));
  console.log("read again", same(firstObjects, objects()), same(firstPrimitives, primitives()));
  console.log("pid", Number.isInteger(process.pid), process.pid > 0, (process.pid | 0) === process.pid, process.pid + 0.5 - process.pid, sumOfIds(5000) === 5000 * process.pid, sumOfIds(1) === firstPrimitives[3]);
  console.log("version", process.version, process.version.charCodeAt(0), `${process.version}!`.length - process.version.length, lengthOfVersions(5000) === 5000 * (process.version.length + Bun.version.length));
  console.log("versions", process.versions.bun === Bun.version, "v" + process.versions.node === process.version, Bun.version.split(".").length);
  console.log("revision", process.revision.length, process.revision === Bun.revision, process.revision.slice(0, 4) === Bun.revision.slice(0, 4));
  console.log("flags", process.isBun, process.browser, Bun.isMainThread, process.isBun ? "is Bun" : "is not Bun", process.browser ? "a browser" : "no browser");
  console.log("paths", process.execPath.length > 0, process.execPath === firstPrimitives[1], bun.cwd.length > 0, bun.cwd === firstPrimitives[8]);
  console.log("streams", process.stdin.fd, process.stdout.fd, process.stderr.fd, typeof process.stdout.write, typeof process.stderr.write, typeof process.stdin.on);
  console.log("files", Bun.stdin instanceof Blob, Bun.stdout instanceof Blob, Bun.stderr instanceof Blob, Bun.stdout === Bun.stderr);
  console.log("records", Object.keys(process.config).sort().join(), typeof process.config.variables, typeof process.features.ipv6, typeof process.versions.v8);

  console.log("env", process.env === Bun.env, variable(5000));
  process.env.COMPUTED_ONCE = "set";
  console.log("env", variable(3), process.env === firstObjects[1]);
  Bun.env.COMPUTED_ONCE = "set through Bun";
  console.log("env", variable(3), Bun.env === firstObjects[7]);
  delete process.env.COMPUTED_ONCE;
  console.log("env", variable(3));

  const readers: (() => unknown)[] = [() => process.pid, () => process.version, () => process.versions, () => process.env, () => process.stdout, () => Bun.version, () => Bun.env, () => Bun.isMainThread];
  console.log("closures", readers.map(read => Object.is(read(), read())).join(), readers[0]() === process.pid, readers[3]() === readers[6]());
}

function membersStoredTo() {
  const originalName = process.argv0;
  console.log("argv0", typeof originalName, nameOfProgram(5000) === originalName);
  process.argv0 = "renamed";
  console.log("argv0", nameOfProgram(3), process.argv0);
  process.argv0 = originalName;
  console.log("argv0", nameOfProgram(3) === originalName);

  const originalRelease = process.release;
  console.log("release", nameOfRelease(5000), process.release === originalRelease);

  const originalArguments = Bun.argv;
  console.log("Bun.argv", Array.isArray(originalArguments), originalArguments.length > 0, argumentsOfBun(5000) === originalArguments);
  bun.argv = ["replaced"];
  console.log("Bun.argv", JSON.stringify(argumentsOfBun(3)));
  bun.argv = originalArguments;
  console.log("Bun.argv", argumentsOfBun(3) === originalArguments);

  const originalRevision = Bun.revision;
  console.log("Bun.revision", outcomeOf(() => void (bun.revision = "another")), Bun.revision === originalRevision, Bun.revision === process.revision);
}

async function environmentSharedWithWorker(firstObjects: unknown[]) {
  process.env.COMPUTED_ONCE = "set by the main thread";
  const worker = new Worker(new URL(import.meta.url), { env: SHARE_ENV, workerData: process.pid });
  const said = new Promise<string>(resolve => worker.once("message", resolve));
  const ended = new Promise<number>(resolve => worker.once("exit", resolve));
  console.log("shared env", process.env === firstObjects[1], Bun.env === firstObjects[7], process.env === Bun.env);
  console.log("worker", await said, await ended);
  console.log("shared env", variable(5000), objects().map((value, index) => value === firstObjects[index]).join());
}

function inWorker() {
  const found = variable(3);
  process.env.COMPUTED_ONCE = "set by the worker";
  parentPort!.postMessage([found, variable(3), Bun.isMainThread, process.pid === workerData, sumOfIds(5000) === 5000 * workerData, process.env === Bun.env, process.versions === process.versions, same(primitives(), primitives())].join());
}

if (Bun.isMainThread) {
  const firstObjects = objects();
  const firstPrimitives = primitives();
  membersNeverStoredTo(firstObjects, firstPrimitives);
  membersStoredTo();
  Bun.gc(true);
  console.log("after a collection", same(firstObjects, objects()), same(firstPrimitives, primitives()), sumOfIds(5000) === 5000 * process.pid, variable(3), process.versions.bun === Bun.version);
  await environmentSharedWithWorker(firstObjects);
} else {
  inWorker();
}
