// node:worker_threads: workerData of every shape, parentPort, threadId, resourceLimits, receiveMessageOnPort, environment data, argv, env, SHARE_ENV, name, ref and unref, stdout and stderr as streams, markAsUntransferable.
import * as threads from "node:worker_threads";
import { Worker, isMainThread, parentPort, workerData, threadId, resourceLimits, receiveMessageOnPort, MessageChannel, MessagePort, setEnvironmentData, getEnvironmentData, SHARE_ENV, markAsUntransferable, isMarkedAsUntransferable } from "node:worker_threads";

type Config = { name: string; limits: { low: number; high: number }; tags: string[]; when: Date; table: Map<string, number>; bytes: Uint8Array };
function spread(config: Config): string {
  return `${config.name} ${config.limits.high - config.limits.low} ${config.tags.join("+")} ${config.when.getTime()} ${[...config.table].join(";")} ${config.bytes.join("")}`;
}
const attempt = (what: string, run: () => unknown) => {
  try {
    console.log(what, "=", run());
  } catch (error) {
    console.log(what, "THROWS", (error as any).code ?? (error as Error).name, (error as Error).message);
  }
};
const text = async (stream: AsyncIterable<unknown>) => {
  let all = "";
  for await (const chunk of stream) all += chunk;
  return all;
};

if (isMainThread) {
  console.log("the module:", Object.keys(threads).sort().join());
  console.log("here:", isMainThread, parentPort, workerData, threadId, JSON.stringify(resourceLimits));
  setEnvironmentData("text", "shared");
  setEnvironmentData("object", { deep: [1, { two: 2 }], when: new Date(9) });
  setEnvironmentData(5 as any, new Map([[1, 2]]));
  setEnvironmentData("gone", 1);
  setEnvironmentData("gone", undefined);
  console.log("environment data here:", getEnvironmentData("text"), JSON.stringify(getEnvironmentData("object")), getEnvironmentData("gone"), getEnvironmentData("never"));

  const config: Config = { name: "cfg", limits: { low: 2, high: 10 }, tags: ["a", "b"], when: new Date(1000), table: new Map([["k", 1]]), bytes: new Uint8Array([1, 2, 3]) };
  process.env.FROM_MAIN = "seen";
  const run = async (mode: string, options: Record<string, any> = {}) => {
    const worker = new Worker(new URL(import.meta.url), { ...options, workerData: options.workerData ?? { mode } });
    const messages: unknown[] = [];
    worker.on("message", (message: unknown) => messages.push(message));
    worker.on("error", (error: unknown) => messages.push("error " + (error as any).code + " " + (error as Error).message));
    const out = options.stdout ? text(worker.stdout) : "", err = options.stderr ? text(worker.stderr) : "";
    const code = await new Promise(resolve => worker.on("exit", resolve));
    console.log(mode + ":", JSON.stringify(messages), "exit", code, options.stdout ? JSON.stringify(await out) : "", options.stderr ? JSON.stringify(await err) : "");
  };
  await run("data", { workerData: { mode: "data", config } });
  await run("facts");
  await run("environment");
  await run("argv", { argv: ["one", 2, "three"] as any });
  await run("env");
  await run("env", { env: { ONLY: "this" } });
  await run("env", { env: SHARE_ENV });
  console.log("set by the worker under SHARE_ENV:", process.env.FROM_WORKER);
  delete process.env.FROM_WORKER;
  await run("env", {});
  console.log("set by the worker with a copy:", process.env.FROM_WORKER);
  await run("limits", { resourceLimits: { maxOldGenerationSizeMb: 64, maxYoungGenerationSizeMb: 8, codeRangeSizeMb: 16, stackSizeMb: 2 } });
  await run("limits");
  await run("streams", { stdout: true, stderr: true });
  await run("name", { name: "a named worker" });
  await run("stdin", { stdin: true });

  for (const data of [undefined, null, 0, -0, "text", 10n, [1, , 3], new Set([1]), new Error("as data"), new Uint8Array(2)]) {
    const worker = new Worker(new URL(import.meta.url), { workerData: data });
    console.log("workerData", typeof data, "=>", await new Promise(resolve => worker.once("message", resolve)));
    await worker.terminate();
  }
  attempt("workerData that cannot be cloned", () => new Worker(new URL(import.meta.url), { workerData: () => 1 }));
  attempt("workerData with a symbol", () => new Worker(new URL(import.meta.url), { workerData: { s: Symbol("x") } }));
  const movedData = new Uint8Array([9, 9]);
  const mover = new Worker(new URL(import.meta.url), { workerData: { mode: "moved", movedData }, transferList: [movedData.buffer] });
  console.log("moved as workerData:", await new Promise(resolve => mover.once("message", resolve)), movedData.length);
  await mover.terminate();

  const { port1, port2 } = new MessageChannel();
  console.log("nothing waits:", receiveMessageOnPort(port2));
  port1.postMessage(config);
  port1.postMessage(undefined);
  port1.postMessage(null);
  const first = receiveMessageOnPort(port2) as { message: Config };
  console.log("received at once:", spread(first.message), first.message !== config, JSON.stringify(receiveMessageOnPort(port2)), JSON.stringify(receiveMessageOnPort(port2)), receiveMessageOnPort(port2));
  attempt("receiveMessageOnPort of no port", () => receiveMessageOnPort({} as any));
  console.log("a port is:", port1 instanceof MessagePort, typeof port1.ref, typeof port1.unref, typeof port1.start, typeof port1.on);
  port1.close();

  const pinned = new ArrayBuffer(8);
  markAsUntransferable(pinned);
  console.log("marked:", isMarkedAsUntransferable(pinned), isMarkedAsUntransferable(new ArrayBuffer(1)));
  const other = new MessageChannel();
  attempt("moving what is marked", () => other.port1.postMessage(pinned, [pinned]));
  console.log("it stays:", pinned.byteLength);
  other.port1.close();

  attempt("a relative text without a dot", () => new Worker("nowhere.js"));
  attempt("a number as the file", () => new Worker(5 as any));
  attempt("an http URL", () => new Worker(new URL("http://example.com/w.js")));

  const quiet = new Worker(new URL(import.meta.url), { workerData: { mode: "stay" } });
  await new Promise(resolve => quiet.once("online", resolve));
  console.log("ids:", typeof quiet.threadId, quiet.threadId > 0, "limits:", JSON.stringify(quiet.resourceLimits), typeof quiet.performance?.eventLoopUtilization);
  quiet.unref();
  quiet.ref();
  quiet.unref();
  console.log("terminate:", await quiet.terminate(), "again:", await quiet.terminate(), "id behind it:", quiet.threadId);
  attempt("a message behind the end", () => quiet.postMessage(1));
} else {
  const mode = workerData?.mode;
  const post = (value: unknown) => parentPort!.postMessage(value);
  if (mode === "data") post(spread(workerData.config));
  else if (mode === "facts") post([isMainThread, typeof threadId, threadId > 0, parentPort instanceof MessagePort, Bun.isMainThread, typeof process.pid, process.argv.length]);
  else if (mode === "environment") {
    post([getEnvironmentData("text"), JSON.stringify(getEnvironmentData("object")), (getEnvironmentData("object") as any).when instanceof Date, [...(getEnvironmentData(5 as any) as Map<number, number>)].join(), getEnvironmentData("gone") === undefined]);
    setEnvironmentData("text", "changed in the worker");
    const inner = new Worker(new URL(import.meta.url), { workerData: { mode: "inner" } });
    inner.on("message", post);
  } else if (mode === "inner") post("the worker's worker: " + getEnvironmentData("text"));
  else if (mode === "argv") post(process.argv.slice(2));
  else if (mode === "env") {
    post([process.env.FROM_MAIN, process.env.ONLY, Object.keys(process.env).length > 2]);
    process.env.FROM_WORKER = "written";
  } else if (mode === "limits") post(resourceLimits);
  else if (mode === "streams") {
    console.log("to stdout");
    console.error("to stderr");
    process.stdout.write("written\n");
  } else if (mode === "name") post(typeof (threads as any).threadName + " " + (globalThis as any).name);
  else if (mode === "stdin") post(typeof process.stdin.on);
  else if (mode === "moved") post([...workerData.movedData]);
  else if (mode === "stay") setInterval(() => {}, 1000);
  else post(workerData instanceof Error ? "Error " + workerData.message : workerData instanceof Set ? "Set " + [...workerData] : workerData instanceof Uint8Array ? "bytes " + workerData.length : Array.isArray(workerData) ? "list " + workerData.length + " " + (1 in workerData) : Object.is(workerData, -0) ? "-0" : String(workerData));
}
