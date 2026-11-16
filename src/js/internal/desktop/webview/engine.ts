// The browser engine that renders, in sandboxed processes of its own, what the app does not trust.
const executablesOfElectron = { darwin: "Electron.app/Contents/MacOS/Electron", win32: "electron.exe" };

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const native = require("internal/desktop/native");
const wire = require("internal/desktop/webview/wire");
const { app } = require("internal/desktop/app");

type Choice = { type: "electron" | "chromium"; path: string; args?: string[] };
type Pending = { resolve(value: any): void; reject(error: unknown): void };

const IDLE_MS = 30_000;
/** The switches of the app that it gets. None of them turns the sandbox off. */
const forwarded =
  /^(?:(?:no-)?proxy-.*|host-(?:resolver-)?rules|log-net-log|net-log-capture-mode|use-fake-(?:device|ui)-for-media-stream|auth-.*|(?:en|dis)able-(?:features|blink-features|logging|http2|quic|http-cache|dev-shm-usage|ntlm-v2)|disable-gpu(?:-compositing)?|use-(?:gl|angle)|ozone-platform.*|ignore-certificate-errors.*|disk-cache-size|autoplay-policy|(?:force-)?webrtc-.*|v|vmodule)$/;
let choice: Choice | null | undefined;
let running: Engine | undefined;

function choose(wanted: Choice | null) {
  if (wanted !== null && !(/^(?:electron|chromium)$/.test(wanted?.type) && path.isAbsolute(String(wanted.path)))) {
    throw new TypeError(`Expected null or { type: "electron" | "chromium", path: string } with an absolute path`);
  }
  choice = wanted && { type: wanted.type, path: wanted.path, args: wanted.args?.map(String) };
}

function find(): Choice | null {
  if (choice !== undefined) return choice;
  const executable = executablesOfElectron[process.platform];
  const bundled = path.join(
    native.resourcesPath() ?? (process as any).resourcesPath ?? app.getAppPath(),
    "electron",
    executable ?? "electron",
  );
  if (fs.existsSync(bundled)) return (choice = { type: "electron", path: bundled });
  const installed = native.findChrome();
  return (choice = installed ? { type: "chromium", path: installed } : null);
}

/** `resources/app.asar`, for a build of Electron that runs nothing else. */
function hasOwnScript(executable: string) {
  const resources = process.platform === "darwin" ? "../../Resources" : "../resources";
  return ["app.asar", "app"].some(name => fs.existsSync(path.resolve(executable, resources, name)));
}

/** And removes those of the processes that were killed. */
function makeTemporary(parent: string) {
  let prefix = "bun-web-";
  try {
    // A container has process ids of its own.
    prefix += fs.statSync("/proc/self/ns/pid").ino + "-";
  } catch {}
  for (const name of fs.readdirSync(parent)) {
    try {
      if (name.startsWith(prefix)) process.kill(parseInt(name.slice(prefix.length)) || process.pid, 0);
    } catch (error: any) {
      if (error.code === "ESRCH") fs.rm(path.join(parent, name), { recursive: true, force: true }, () => {});
    }
  }
  return fs.mkdtempSync(path.join(parent, `${prefix}${process.pid}-`));
}

function writeHelper(directory: string) {
  const sources = native.ask("webview.helper", {});
  const head = `const wire = (() => {${sources.wire.replace("export default", "return")}})();\n`;
  fs.writeFileSync(path.join(directory, "main.js"), head + sources.main);
  fs.writeFileSync(path.join(directory, "frame.js"), head + sources.frame);
  fs.writeFileSync(path.join(directory, "package.json"), `{"name":"web-engine","version":"1.0.0","main":"main.js"}`);
}

class Engine {
  /** What a message of each kind is for. The modules that send commands fill it. */
  static handlers: Record<string, Function> = { __proto__: null as any };
  static handles: Record<string, Function> = { __proto__: null as any };
  static handleOf: ((value: any) => unknown)[] = [];

  type: string;
  directory: string;
  views = new Map<number, any>();
  sessions = new Map<number, any>();
  objects = new Map<number, any>();
  /** Listeners for the events of each session of the DevTools protocol. */
  inspected = new Map<string | undefined, (method: string, params: any, session: string) => void>();
  isClosed = false;
  hasAnswered = false;
  creationTime = Date.now();
  /** On Wayland it is for the application that has the focus. */
  hasOwnClipboard: boolean;
  copied = "";
  paintsToFiles: boolean;
  /** What a URL or an origin is called there. */
  toEngine = (url: string) => url;
  fromEngine = (url: string) => url;
  /** While the other side waits for an answer, what it does before it goes on. */
  collected: unknown[][] | undefined;
  #child;
  #backend: any;
  #pending = new Map<number, Pending>();
  #nextId = 1;
  #holds = 0;
  #idle: Timer | undefined;
  #collectable = new FinalizationRegistry<number>(id => this.send("release", id));

  constructor({ type, path: executable, args: given = [] }: Choice) {
    this.type = type;
    this.hasOwnClipboard = type === "chromium" || (process.platform === "linux" && !!process.env.WAYLAND_DISPLAY);
    this.directory = makeTemporary(os.tmpdir());
    const profile = path.join(app.getPath("sessionData"), "Web Engine", "Process");
    const args = [`--lang=${app.getLocale()}`];
    // It has no window on screen, and the cookies are not kept there.
    args.push("--disable-renderer-backgrounding", "--use-mock-keychain", "--password-store=basic", ...given);
    for (const [name, value] of (app as any).commandLine?.appended ?? []) {
      if (forwarded.test(name)) args.push(value ? `--${name}=${value}` : `--${name}`);
    }
    if (type === "chromium") {
      const { switches } = require("internal/desktop/webview/chromium");
      args.push("--remote-debugging-pipe", ...switches(path.join(this.directory, "profile")));
    } else if (!hasOwnScript(executable)) {
      writeHelper(this.directory);
      args.push(this.directory);
    }
    const { ELECTRON_RUN_AS_NODE: _, NODE_OPTIONS: __, ...env } = process.env;
    const log = env.ELECTRON_ENABLE_LOGGING ? "inherit" : "ignore";
    const pipes: unknown[] = type === "chromium" ? ["pipe", "pipe"] : ["ignore", "ignore", "pipe", "pipe", "pipe"];
    const frames = type === "electron" ? native.ask("webview.channel", {}) : null;
    this.paintsToFiles = type === "electron" && frames === null;
    if (frames !== null) pipes.push(frames);
    const child = (this.#child = require("node:child_process").spawn(executable, args, {
      stdio: ["ignore", log, log, ...pipes],
      env,
      windowsHide: true,
    }));
    if (frames !== null) fs.closeSync(frames);
    child.once("error", () => this.close());
    child.once("exit", () => this.close());
    child.unref();
    for (const pipe of child.stdio!.slice(3, 8)) pipe?.on("error", () => this.close()).unref?.();

    if (type === "chromium") {
      let partial: Buffer[] = [];
      child.stdio![4]?.on("data", (chunk: Buffer) => {
        for (let end; (end = chunk.indexOf(0)) !== -1; chunk = chunk.subarray(end + 1)) {
          const text = Buffer.concat([...partial, chunk.subarray(0, end)]).toString();
          partial = [];
          try {
            this.#receiveFromInspector(JSON.parse(text));
          } catch (error) {
            setImmediate(() => {
              throw error;
            });
          }
        }
        partial.push(chunk);
      });
      const chromium = require("internal/desktop/webview/chromium");
      ({ toEngine: this.toEngine, fromEngine: this.fromEngine } = chromium);
      this.#backend = new chromium.Backend(
        this,
        (...message: unknown[]) => this.#receive(message),
        (...handle: unknown[]) => this.#fromHandle(handle),
      );
      return;
    }
    child.stdio![6]?.on(
      "data",
      wire.splitter((bytes: Buffer) => {
        this.hasAnswered = true;
        return this.#receive(wire.decode(bytes, this.#fromHandle));
      }),
    );
    const { schemes } = require("internal/desktop/electron/policy");
    this.#answer({
      name: app.getName(),
      directory: profile,
      temporary: this.directory,
      userAgent: (app as any).userAgentFallback,
      schemes: Array.from(schemes, ([scheme, privileges]) => ({ scheme: scheme.slice(0, -1), privileges })),
    });
  }

  get pid(): number | undefined {
    return this.#child.pid;
  }

  /** The processes that it has started, as of the last time. */
  metrics: any[] = [];

  measure() {
    if (this.type !== "electron") return;
    this.perform("module", "app", "getAppMetrics").then(
      metrics => (this.metrics = metrics.filter(it => it.type !== "Browser")),
      () => {},
    );
  }

  newId() {
    // The helper counts up from 1.
    return -this.#nextId++;
  }

  #fromHandle = ([kind, ...rest]: any[]) => {
    if (kind === "data") return wire.decode(rest[0].subarray(4));
    if (kind !== "function") return Engine.handles[kind](this, ...rest);
    const callback = (...args: unknown[]) => this.tell("object", rest[0], "", args);
    this.#collectable.register(callback, rest[0]);
    return callback;
  };

  #handleOf = (value: unknown) => {
    for (const handleOf of Engine.handleOf) {
      const handle = handleOf.$call(this, value);
      if (handle !== undefined) return handle;
    }
  };

  #answer(value: unknown) {
    this.#child.stdio[7]?.write(wire.encode(value, this.#handleOf));
  }

  #settle(id: number, isError: boolean, value: unknown) {
    const pending = this.#pending.$get(id);
    this.#pending.$delete(id);
    if (isError) pending?.reject(value);
    else pending?.resolve(value);
  }

  #receive([name, ...args]: any[]): unknown {
    if (this.isClosed) return;
    const run = (name: string, ...args: unknown[]) => Engine.handlers[name](this, ...args);
    if (name === "reply") return this.#settle(args[0], args[1], args[3] ? Object.assign(args[2], args[3]) : args[2]);
    if (name === "inspected") return this.#receiveFromInspector(JSON.parse(args[0]));
    if (name === "request") {
      const [id, ...message] = args;
      return void Promise.try(run, ...(message as [string])).then(
        value => this.send("answer", id, false, value),
        error => this.send("answer", id, true, String(error)),
      );
    }
    if (name !== "ask") return run(name, ...args);
    // What a listener that throws was asked about does not happen.
    let answer: unknown = args[0] === "event" ? { isPrevented: true, calls: [] } : undefined;
    try {
      return (answer = run(...(args as [string])));
    } finally {
      if (!this.#backend) this.#answer(answer);
    }
  }

  #receiveFromInspector({ id, result, error, method, params, sessionId }: any) {
    this.hasAnswered = true;
    if (id === undefined) return this.inspected.$get(sessionId)?.(method, params, sessionId);
    this.#settle(id, !!error, error ? Object.assign(new Error(error.message), { code: error.code }) : result);
  }

  #expect(send: (id: number) => void): Promise<any> {
    if (this.isClosed) return Promise.$reject(new Error("The web engine has exited"));
    const { promise, resolve, reject } = Promise.withResolvers();
    const id = this.#nextId++;
    send(id);
    this.#pending.$set(id, { resolve, reject });
    return promise;
  }

  send(...message: unknown[]) {
    if (this.isClosed) return;
    if (this.#backend) this.#backend.run(message);
    else this.#child.stdio[5]?.write(wire.encode(message, this.#handleOf));
  }

  /** `holdsUp` the commands after it until it has finished. */
  perform(kind: string, id: unknown, method: string, args: unknown[] = [], holdsUp = false) {
    return this.#expect(reply => this.send("call", reply, kind, id, method, args, holdsUp));
  }

  tell(kind: string, id: unknown, method: string, args: unknown[] = []) {
    const { collected } = this;
    if (collected && kind === "object") collected.push([kind, id, method, args]);
    else this.send("call", 0, kind, id, method, args);
  }

  request(name: string, ...args: unknown[]) {
    return this.#expect(reply => this.send(name, reply, ...args));
  }

  #sendToInspector(message: object) {
    const text = JSON.stringify(message);
    if (this.type === "chromium") this.#child.stdio[3]?.write(text + "\0");
    else this.send("inspect", text);
  }

  inspect(method: string, params?: object, sessionId?: string) {
    return this.#expect(id => this.#sendToInspector({ id, method, params, sessionId }));
  }

  /** `pending` is called in the order of the messages, among which are the events. */
  inspectInOrder(method: string, params: object, sessionId: string, pending: Pending) {
    if (this.isClosed) return pending.reject(new Error("The web engine has exited"));
    const id = this.#nextId++;
    this.#pending.$set(id, pending);
    this.#sendToInspector({ id, method, params, sessionId });
  }

  releaseWith(owner: object, id: number) {
    this.#collectable.register(owner, id);
  }

  /** It runs for as long as something holds it. */
  hold() {
    this.#holds++;
    clearTimeout(this.#idle);
    let isReleased = false;
    return () => {
      if (isReleased) return;
      isReleased = true;
      if (--this.#holds === 0) (this.#idle = setTimeout(() => this.close(), IDLE_MS)).unref();
    };
  }

  close() {
    if (this.isClosed) return;
    this.isClosed = true;
    running = undefined;
    clearTimeout(this.#idle);
    for (const pipe of this.#child.stdio.slice(3, 8)) pipe?.destroy();
    fs.rmSync(this.directory, { recursive: true, force: true, maxRetries: 3 });
    this.#pending.$forEach(it => it.reject(new Error("The web engine has exited")));
    for (const all of [this.views, this.sessions, this.objects])
      for (const it of Array.from(all.values())) it.engineClosed?.();
  }
}

function start(): Engine {
  if (running) return running;
  const found = find();
  if (!found) throw new Error("There is no web engine for pages that are not trusted. See app.setWebEngine().");
  return (running = new Engine(found));
}

process.on("exit", () => running?.close());

export default { Engine, choose, isAvailable: () => find() !== null, running: () => running, start, writeHelper };
