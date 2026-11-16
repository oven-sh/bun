// A web worker is a realm on a thread of its own, whose requests the main thread makes.
const compiled = require("internal/desktop/electron/compiled");
const policy = require("internal/desktop/electron/policy");
const { Client } = require("internal/desktop/electron/page_network");
const { MARKER } = require("internal/desktop/electron/worker_thread");

let entryOfScript: string | undefined;

type Options = { url: string; isModule: boolean; name: string; credentials: string; blob?: Blob };
type Failure = { message: string; filename?: string; lineno?: number; colno?: number };

declare const Worker: new (entry: string, options: object) => any;

class WorkerClient extends Client {
  #thread: any;
  #port: MessagePort | undefined;
  #logsTo: any;
  /** What was sent before the script had been loaded. */
  #early: [unknown[], unknown[]?][] = [];

  constructor(creator: any, { url }: Options) {
    super(creator.webContents, url);
    this.origin = url.startsWith("data:") ? "null" : creator.origin;
    this.#logsTo = creator;
    this.checksOrigins = creator.checksOrigins;
    this.ancestors = () => creator.ancestors();
    this.isSecure = () => creator.isSecure();
  }

  log(...args: unknown[]) {
    if (!this.#logsTo.disposed) this.#logsTo.log(...args);
  }

  tellScripts(type: string, body: object) {
    this.tell("report", [type, body]);
  }

  tell(name: string | number, args: unknown[], transfer?: unknown[]) {
    if (this.#port) this.#port.postMessage([0, name, args], transfer as any);
    else this.#early.push([[0, name, args], transfer]);
  }

  async start(creator: any, options: Options, isShared: boolean, onError: (failure?: Failure) => void) {
    const { isModule, credentials, blob } = options;
    const destination = isShared ? "sharedworker" : "worker";
    let script: any = {};
    if (!compiled.pathOf(this.url)) {
      try {
        script = await creator.loadScript(this.url, isModule ? "" : "classic", {
          destination,
          mode: "same-origin",
          credentials: isModule ? credentials : "same-origin",
          initiator: isShared ? undefined : "other",
          blob,
        });
      } catch {
        this.dispose();
        return onError();
      }
      if (this.disposed) return;
      this.url = script.url;
    }
    if (/^https?:/.test(this.url) && script.headers) this.setPolicies(script.headers);
    else this.setPolicies([], creator);
    this.isIsolated = creator.isIsolated && this.origin !== "null";
    // The entry point of an executable loads this module first, and then only goes on in the main process.
    const entry =
      compiled.roots.length > 0
        ? Bun.main
        : (entryOfScript ??= URL.createObjectURL(
            new Blob([`process.getBuiltinModule("bun:desktop/electron")`], { type: "text/javascript" }),
          ));
    const { port1: port, port2 } = new MessageChannel();
    const thread = (this.#thread = new Worker(entry, {
      name: options.name,
      argv: [MARKER],
      env: {},
      ref: false,
      smol: true,
      transferList: [port2],
      workerData: {
        port: port2,
        options: {
          ...this.about(),
          name: options.name,
          isModule,
          isShared,
          credentials,
          source: script.source,
          allowsEval: this.csp.allowsEval() && !compiled.isExclusive,
          allowsWebAssembly: this.csp.allowsWebAssembly(),
          watchesEval: this.csp.watchesEval(),
          requiresTrustedTypes: this.csp.requiresTrustedTypes(),
          storagePath: this.webContents.session.storagePath,
          roots: compiled.roots,
          schemes: [...policy.schemes],
          /** Set to 1 when the answer that the worker blocks on has been sent. */
          signal: new Int32Array(new SharedArrayBuffer(4)),
        },
      },
    } as any));
    this.#port = port;
    for (const [message, transfer] of this.#early.splice(0)) port.postMessage(message, transfer as any);

    /** What calls have returned that has methods. */
    const handles = new Map<number, any>();
    const services = this.services();
    const calls = {
      ...services,
      socketOptions: async (url: string, given: object) => {
        const { proxy, headers, tls } = await services.socketOptions(url, given);
        if (!url.startsWith("wss:")) return { proxy, headers };
        if (tls.checkServerIdentity) throw new Error("The certificate cannot be verified from a worker.");
        return { proxy, headers, tls };
      },
      loadSync: this.loadWhole,
      loadScriptSync: this.loadScript,
      // What a module worker imports before it runs is loaded for whoever started it.
      loadFirstModule: (url: string, type: string, more: object) =>
        creator.loadScript(url, type, { ...more, ...(type === "" && { destination }) }),
      console: (level: string, message: string, line: number, source: string) => this.log(level, message, line, source),
      uncaught: (message: string, filename: string, lineno: number, colno: number) => {
        if (isShared) this.log("error", message, lineno, filename);
        else onError({ message, filename, lineno, colno });
      },
      failedToStart: () => onError(),
      invoke: (handle: number, method: string, isLast: boolean) => {
        const result = handles.$get(handle)?.[method]();
        if (isLast) handles.$delete(handle);
        return result;
      },
    };
    const answer = async (id: number, name: string, args: any[]) => {
      if (name !== "load") {
        const result = calls[name](...args);
        if (result?.release || result?.terminate) return void handles.$set(id, result);
        return result;
      }
      const load: any = this.load(args[0]);
      handles.$set(id, load);
      const { reader, ...loaded } = await load.promise.catch(error => (handles.$delete(id), Promise.$reject(error)));
      if (!reader) handles.$delete(id);
      load.read = () => reader.read().then(chunk => (chunk.done && handles.$delete(id), chunk));
      return { ...loaded, hasBody: !!reader };
    };
    (port as any).onmessage = async ({ data: [id, name, args, callbackAt, signal] }) => {
      if (callbackAt >= 0) args[callbackAt] = (...given: unknown[]) => this.tell(id, given);
      let message;
      try {
        message = [id, await answer(id, name, args)];
      } catch (error: any) {
        message = [id, undefined, { name: error?.name, message: String(error?.message), code: error?.code }];
      }
      port.postMessage(message);
      if (!signal) return;
      Atomics.store(signal, 0, 1);
      Atomics.notify(signal, 0);
    };
    (port as any).unref();
    thread.onerror = ({ message }) => void (this.disposed || onError({ message }));
    thread.addEventListener("close", () => {
      port.close();
      handles.$forEach(handle => handle.release?.());
      this.dispose();
    });
  }

  dispose() {
    if (this.disposed) return;
    super.dispose();
    this.#thread?.terminate();
  }
}

function create(creator: any, options: Options, port: MessagePort, onError: (failure?: Failure) => void) {
  const worker = new WorkerClient(creator, options);
  const terminate = () => void (creator.cleanups.delete(terminate), worker.dispose());
  creator.cleanups.add(terminate);
  worker.tell("connect", [port], [port]);
  worker.start(creator, options, false, failure => creator.disposed || onError(failure));
  return { terminate };
}

const shared = new Map<string, { worker: WorkerClient; options: Options; owners: Set<object> }>();

function connect(creator: any, storageKey: string, options: Options, port: MessagePort, onError: () => void) {
  const key = `${storageKey}\n${options.url}\n${options.name}`;
  let found = shared.$get(key);
  if (!found || found.worker.disposed) {
    shared.$set(key, (found = { worker: new WorkerClient(creator, options), options, owners: new Set() }));
    found.worker.start(creator, options, true, () => creator.disposed || onError());
  }
  const { worker, owners } = found;
  const isAlike = ["credentials", "hasExtendedLifetime", "isModule"].every(it => found.options[it] === options[it]);
  if (!isAlike || worker.isSecure() !== creator.isSecure()) return void setImmediate(onError);
  worker.tell("connect", [port], [port]);
  owners.$add(creator);
  creator.cleanups.add(() => {
    if (!owners.$delete(creator) || owners.$size > 0) return;
    worker.dispose();
    if (shared.$get(key) === found) shared.$delete(key);
  });
}

export default { connect, create };
