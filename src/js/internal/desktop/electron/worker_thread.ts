// The thread of a web worker.
const compiled = require("internal/desktop/electron/compiled");
const policy = require("internal/desktop/electron/policy");
const tasks = require("internal/desktop/tasks");

/** The last of its arguments. */
const MARKER = "--type=web-worker";

/** By the objects that are being transferred, which may be of another realm than the script that does it. */
const transfers = new WeakMap();

/** What a realm gets from the main realm of its own thread. */
function ofThread() {
  return {
    originOf: policy.originOf,
    isSameSite: policy.isSameSite,
    compiledPath: compiled.pathOf,
    tasks,
    transfers,
    resolveBlob: policy.resolveBlob,
    revokeObjectUrl: (url: string) => URL.revokeObjectURL("blob:" + url.slice(-36)),
    readBlobSync: (blob: Blob) => Bun.peek(Blob.prototype.bytes.$call(blob)),
    typeOfFile: (name: string) => Bun.file(name).type.split(";")[0].replace("application/octet-stream", ""),
    fs: () => require("node:fs"),
  };
}

/** Whether this thread is such a worker, which is then started. */
function enter(createRealm: Function) {
  if (process.argv.at(-1) !== MARKER) return false;
  const {
    0: { options, port: parentPort },
    1: threadId,
    2: receiveMessageOnPort,
  } = $cpp("Worker.cpp", "createNodeWorkerThreadsBinding") as any;
  for (const [protocol, privileges] of options.schemes) policy.schemes.set(protocol, privileges);
  compiled.roots.push(...options.roots);

  const waiting = new Map<number, { resolve: Function; reject: Function }>();
  const listeners = new Map<number | string, Function>();
  let nextId = 1;
  function accept([id, value, more]: any[]) {
    if (id === 0) return listeners.$get(value)?.(...more);
    const { resolve, reject } = waiting.$get(id)!;
    waiting.$delete(id);
    if (more === undefined) resolve(value);
    else reject(Object.assign(new Error(), more));
  }
  function ask(name: string, args: unknown[], signal?: Int32Array) {
    const id = nextId++;
    const deferred = Promise.withResolvers<any>();
    const callbackAt = args.findIndex(it => $isCallable(it));
    if (callbackAt >= 0) [args] = [args.with(callbackAt, undefined), listeners.$set(id, args[callbackAt] as Function)];
    waiting.$set(id, deferred);
    $pokePromiseAsHandled(deferred.promise);
    parentPort.postMessage(
      [id, name, args, callbackAt, signal],
      args.filter(it => it instanceof MessagePort),
    );
    return { id, promise: deferred.promise };
  }
  function askSync(name: string, args: unknown[]) {
    const { signal } = options;
    Atomics.store(signal, 0, 0);
    const { id } = ask(name, args, signal);
    let outcome: (() => unknown) | undefined;
    waiting.$set(id, {
      resolve: value => (outcome = () => value),
      reject: error =>
        (outcome = () => {
          throw error;
        }),
    });
    Atomics.wait(signal, 0, 0);
    while (!outcome) {
      const { message } = receiveMessageOnPort(parentPort);
      if (message[0] === 0) setImmediate(accept, message);
      else accept(message);
    }
    return outcome();
  }
  function handleFor(name: string, method: string) {
    return (...args: unknown[]) => {
      const { id } = ask(name, args);
      return { [method]: () => void (listeners.$delete(id), ask("invoke", [id, method, true])) };
    };
  }

  let storage: any;
  let hasStarted = false;
  const openStorage = () =>
    (storage ??= new (require("internal/desktop/electron/storage").Storage)(options.storagePath));
  const env = {
    ...options,
    ...ofThread(),
    load(request: any) {
      let asked: ReturnType<typeof ask> | undefined;
      let isAborted = false;
      const send = (body: unknown) =>
        isAborted ? Promise.$reject() : (asked = ask("load", [{ ...request, body }])).promise;
      const reader = {
        read: () => ask("invoke", [asked!.id, "read"]).promise.then(chunk => chunk ?? Promise.$reject()),
      };
      const sent = request.isStreamed ? new Response(request.body).bytes().then(send) : send(request.body);
      return {
        promise: sent.then(loaded => ({ ...loaded, reader: loaded.hasBody && reader })),
        abort: () => void ((isAborted = true), asked && ask("invoke", [asked.id, "abort", true])),
      };
    },
    loadScript: (...args: unknown[]) => ask(hasStarted ? "loadScript" : "loadFirstModule", args).promise,
    native: () => require("internal/desktop/native").forWorker,
    fontScope: 0x40000000 + threadId,
    wantsConsole: () => true,
    console: (level: string, message: string, line: number, source: string) =>
      ask("console", [level, message, line, source]),
    uncaught: (message: string, source: string, line: number, column: number, _: unknown, isRejection?: boolean) =>
      isRejection ? ask("console", ["error", message, line, source]) : ask("uncaught", [message, source, line, column]),
    requestLock: handleFor("requestLock", "release"),
    requestFileLock: handleFor("requestFileLock", "release"),
    createWorker: (given: object, port: MessagePort, onError: Function) =>
      handleFor("createWorker", "terminate")(given, structuredClone(port, { transfer: [port] }), onError),
    indexedDB: (name: string) => openStorage().indexedDB(options.bucket, name),
    indexedDatabases: () => openStorage().indexedDatabases(options.bucket),
    close: () => setImmediate(process.exit),
  };
  for (const name of [
    "caches",
    "fetchResource",
    "queryLocks",
    "socketOptions",
    "systemVersion",
    "usage",
    "watchResourceTimings",
  ]) {
    env[name] = (...args: unknown[]) => ask(name, args).promise;
  }
  for (const name of [
    "allowsEval",
    "allowsStringFor",
    "allowsTrustedTypesEval",
    "allowsTypePolicy",
    "checkPermission",
    "isOnline",
    "loadScriptSync",
    "loadSync",
    "originDirectory",
    "webSocket",
  ]) {
    env[name] = (...args: unknown[]) => askSync(name, args);
  }
  const realm = createRealm().worker(env);
  if (!options.allowsEval) realm.disableEval();
  if (!options.allowsWebAssembly) realm.disableWebAssembly();
  if (options.watchesEval) realm.watchEval(options.requiresTrustedTypes);
  const ports: MessagePort[] = [];
  listeners.$set("report", realm.tellScripts);
  listeners.$set("connect", (port: MessagePort) => {
    if (hasStarted || !options.isShared) realm.connect(port);
    else ports.push(port);
  });
  if (!options.isShared) accept(receiveMessageOnPort(parentPort).message);
  parentPort.onmessage = ({ data }) => accept(data);
  realm
    .prepare(compiled.pathOf(options.url))
    .then(run => {
      hasStarted = true;
      run();
      for (const port of ports.splice(0)) realm.connect(port);
    })
    .then(undefined, () => ask("failedToStart", []).promise.then(env.close));
  return true;
}

export default { MARKER, enter, ofThread };
