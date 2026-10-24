// Instances of the host's classes that have no public constructor: what a server, a connection, a child process or a handler is given.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { SourceMap } from "node:module";
import { join } from "node:path";
import { everyCandidate, operandOrigin, Unavailable, type Candidate } from "../differential/instances";
import type { Realm } from "../differential/members";
import { isObject } from "../differential/table-description";

export type Opened = { value: object; close(): unknown };
export type Open = (realm: Realm) => Promise<Opened> | Opened;

const keysFolder = join(import.meta.dir, "../../../js/node/test/fixtures/keys");
const readKey = (name: string) => readFileSync(join(keysFolder, name), "utf8");
const createTLSOptions = () => ({ cert: readKey("agent1-cert.pem"), key: readKey("agent1-key.pem") });
const noop = () => {};
const socketHandlers = { data: noop, close: noop, error: noop, drain: noop, end: noop, timeout: noop, connectError: noop, handshake: noop };

export function bindingOf(realm: Realm, path: string): any {
  const entry = realm.table.dump.entries.find(other => other.path === path);
  const value = entry && realm.valueOf(entry.token);
  if (value === undefined) throw new Unavailable(`this realm does not hand out ${path}`);
  return value;
}

function hostCandidate(realm: Realm, instanceOf: string, open: Open): Candidate {
  let current: Opened | undefined;
  return {
    name: `host:${instanceOf}`,
    kind: "Pristine",
    instanceOf,
    async prepare() {
      try {
        current = await open(realm);
      } catch {
        current = undefined;
      }
    },
    create(log, operand) {
      if (!current) throw new Unavailable(`no ${instanceOf} can be made`);
      log.identify(current.value, operandOrigin(operand));
      return current.value;
    },
    release() {
      try {
        void current?.close();
      } catch {}
      current = undefined;
    },
  };
}

async function openTLSSocket(): Promise<Opened> {
  const { promise, resolve } = Promise.withResolvers<object>();
  const listener = Bun.listen({ hostname: "localhost", port: 0, tls: createTLSOptions(), socket: { ...socketHandlers, open: resolve } });
  const client = await Bun.connect({
    hostname: "localhost",
    port: listener.port,
    tls: { rejectUnauthorized: false },
    socket: { ...socketHandlers, open: noop },
  });
  return {
    value: await promise,
    close() {
      client.end();
      listener.stop(true);
    },
  };
}

function openServer(createOptions: () => object): Open {
  return () => {
    const server = Bun.serve({ port: 0, fetch: () => new Response("ok"), ...createOptions() });
    return { value: server, close: () => server.stop(true) };
  };
}

// What node:http is handed for a request: at 4 the response handle.
function openNodeHTTPHandle(position: number): Open {
  return async () => {
    const { promise, resolve } = Promise.withResolvers<object>();
    const server = Bun.serve({
      port: 0,
      onNodeHTTPRequest(...args: unknown[]) {
        resolve(args[position] as object);
      },
    } as any);
    const request = fetch(`http://localhost:${server.port}/a`, { method: "POST", body: "text" }).catch(noop);
    return {
      value: await promise,
      close() {
        void request;
        return server.stop(true);
      },
    };
  };
}

function spawnChild() {
  return Bun.spawn({ cmd: [process.execPath, "-e", "await Bun.sleep(2000)"], stdin: "pipe", stdout: "pipe", stderr: "ignore" });
}

const openSubprocess: Open = () => {
  const child = spawnChild();
  return { value: child, close: () => child.kill() };
};

const openResourceUsage: Open = async () => {
  const child = Bun.spawn({ cmd: [process.execPath, "-e", ""], stdio: ["ignore", "ignore", "ignore"] });
  await child.exited;
  return { value: child.resourceUsage()!, close: noop };
};

const openFileSink: Open = () => {
  const sink = Bun.file("native-contract-sink.txt").writer();
  return { value: sink, close: () => sink.end() };
};

// What `writer()` of a file in a bucket answers. Nothing listens at the endpoint, so what it sends is refused.
const openNetworkSink: Open = () => {
  const client = new Bun.S3Client({ endpoint: "http://127.0.0.1:1", accessKeyId: "a", secretAccessKey: "b", bucket: "c" });
  const sink = client.file("native-contract-sink.txt").writer();
  return { value: sink, close: () => Promise.try(() => sink.end()).catch(noop) };
};

// What `pull` of a direct stream is handed when a native sink takes the stream: here the sink of a file.
const openReadableSinkController: Open = async () => {
  const given = Promise.withResolvers<object>();
  const released = Promise.withResolvers<void>();
  const stream = new ReadableStream({
    type: "direct",
    async pull(controller) {
      given.resolve(controller);
      await released.promise;
    },
  } as any);
  const written = Bun.write("native-contract-controller.txt", new Response(stream)).catch(noop);
  return {
    value: await given.promise,
    close() {
      released.resolve();
      return written;
    },
  };
};

const openRouter = () => {
  mkdirSync("native-contract-pages", { recursive: true });
  writeFileSync("native-contract-pages/index.tsx", "export default 1;");
  return new Bun.FileSystemRouter({ dir: "native-contract-pages", style: "nextjs" });
};

const openTerminal: Open = () => {
  const terminal = new Bun.Terminal({});
  return { value: terminal, close: () => terminal.close() };
};

const openCronJob: Open = () => {
  const job = Bun.cron("0 0 1 1 *", noop);
  return { value: job, close: () => job.stop() };
};

// One red pixel.
const pixel = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==";

// What a matcher of `expect.extend` is called on, or a member of it.
function openMatcherContext(select: (context: any) => object): Open {
  return () => {
    const { expect } = jestOf();
    let context: object | undefined;
    expect.extend({
      nativeContractMatcher(this: object) {
        context = select(this);
        return { pass: true, message: () => "" };
      },
    });
    expect(1).nativeContractMatcher();
    if (context === undefined) throw new Unavailable("the matcher was not called");
    return { value: context, close: noop };
  };
}

const openUDPSocket: Open = async () => {
  const socket = await Bun.udpSocket({ hostname: "127.0.0.1", port: 0, socket: { data: noop, error: noop, drain: noop } });
  return { value: socket, close: () => socket.close() };
};

const openRedisClient: Open = () => {
  const client = new Bun.RedisClient("redis://127.0.0.1:1", { autoReconnect: false, enableOfflineQueue: false, connectionTimeout: 20 });
  return { value: client, close: () => client.close() };
};

const openS3Client: Open = () => ({
  value: new Bun.S3Client({ endpoint: "http://127.0.0.1:1", accessKeyId: "a", secretAccessKey: "b", bucket: "c" }),
  close: noop,
});

const openTimeout: Open = () => {
  const timeout = setTimeout(noop, 60_000);
  return { value: timeout, close: () => clearTimeout(timeout) };
};

const openImmediate: Open = () => {
  const immediate = setImmediate(noop);
  return { value: immediate, close: () => clearImmediate(immediate) };
};

const openFileSystem: Open = realm => ({ value: bindingOf(realm, "native:Bindgen:node_fs_binding.bind.ts:binding"), close: noop });

function openWatcher(method: "watch" | "watchFile"): Open {
  return realm => {
    const binding = bindingOf(realm, "native:Bindgen:node_fs_binding.bind.ts:binding");
    const watcher = method === "watch" ? binding.watch(".", { persistent: false }, noop) : binding.watchFile("native-contract-scratch.txt", { persistent: false, interval: 1000 }, noop);
    return { value: watcher, close: () => watcher.close() };
  };
}

function openCompressor(path: string, mode: number, initialize: (handle: any) => void): Open {
  return realm => {
    const handle = new (bindingOf(realm, path))(mode);
    initialize(handle);
    return { value: handle, close: () => handle.close() };
  };
}

const openFrameParser: Open = realm => {
  const handlers = new Proxy({}, { get: (_, key) => (key === "binaryType" ? "buffer" : noop), has: () => true });
  const parser = new (bindingOf(realm, "native:Bindgen:h2_frame_parser.bind.ts:H2FrameParser"))({ context: {}, settings: {}, handlers });
  return { value: parser, close: noop };
};

const openResolver: Open = realm => {
  const resolver = bindingOf(realm, "native:Bindgen:dns_internals.bind.ts:newResolver")({ timeout: -1, tries: 4 });
  resolver.setServers([[4, "127.0.0.1", 1]]);
  return { value: resolver, close: () => resolver.cancel() };
};

function constructBinding(path: string, ...args: unknown[]): Open {
  return realm => ({ value: new (bindingOf(realm, path))(...args), close: noop });
}

// The objects that a handler of HTMLRewriter is given are valid until the promise it returns is settled.
function openRewriterValue(register: (rewriter: HTMLRewriter, handler: (value: object) => Promise<void>) => void): Open {
  return async () => {
    const given = Promise.withResolvers<object>();
    const released = Promise.withResolvers<void>();
    const rewriter = new HTMLRewriter();
    register(rewriter, value => {
      given.resolve(value);
      return released.promise;
    });
    const text = rewriter.transform(new Response('<!DOCTYPE html><p id="a" class="b"><!--c-->text</p>')).text().catch(noop);
    return {
      value: await given.promise,
      close() {
        released.resolve();
        return text;
      },
    };
  };
}

const openBuildArtifact: Open = async () => {
  mkdirSync("native-contract-build", { recursive: true });
  writeFileSync("native-contract-build/entry.js", "export default 1;");
  const { outputs } = await Bun.build({ entrypoints: ["native-contract-build/entry.js"] });
  return { value: outputs[0], close: noop };
};

const openBuildMessage: Open = async () => {
  mkdirSync("native-contract-build", { recursive: true });
  writeFileSync("native-contract-build/broken.js", "export default (;");
  const { logs } = await Bun.build({ entrypoints: ["native-contract-build/broken.js"], throw: false });
  return { value: logs[0], close: noop };
};

const openResolveMessage: Open = async () => {
  try {
    await import("native-contract-module-that-does-not-exist");
  } catch (error) {
    if (isObject(error)) return { value: error, close: noop };
  }
  throw new Unavailable("the import did not fail");
};

function jestOf(): any {
  return (Bun as any).jest(import.meta.path);
}

// For a class whose instances pass for instances of a built-in class: both of these are errors to every test that JavaScript has.
function instanceOf(className: string, open: Open): Open {
  return Object.assign((realm: Realm) => open(realm), { className });
}

const openers: (Open & { className?: string })[] = [
  openTLSSocket,
  openServer(() => ({ development: false })),
  openServer(() => ({ development: false, tls: createTLSOptions() })),
  openServer(() => ({ development: true })),
  openServer(() => ({ development: true, tls: createTLSOptions() })),
  openNodeHTTPHandle(4),
  openSubprocess,
  openResourceUsage,
  openFileSink,
  openUDPSocket,
  openRedisClient,
  openS3Client,
  openTimeout,
  openImmediate,
  openFileSystem,
  openWatcher("watch"),
  openWatcher("watchFile"),
  openCompressor("native:Bindgen:node_zlib_binding.bind.ts:NativeZlib", 1, handle => handle.init(15, 6, 8, 0, new Uint32Array(2), noop, undefined)),
  openCompressor("native:Bindgen:node_zlib_binding.bind.ts:NativeBrotli", 9, handle => handle.init(new Uint32Array(10), new Uint32Array(2), noop, undefined)),
  openCompressor("native:Bindgen:node_zlib_binding.bind.ts:NativeZstd", 10, handle => handle.init(new Uint32Array(10).fill(-1), undefined, new Uint32Array(2), noop)),
  openFrameParser,
  openResolver,
  constructBinding("native:Bindgen:SocketAddress.bind.ts:SocketAddress", { address: "127.0.0.1", port: 1, family: "ipv4" }),
  constructBinding("native:Bindgen:BlockList.bind.ts:BlockList"),
  realm => ({ value: new (bindingOf(realm, "native:Bindgen:SecureContext.bind.ts:SecureContext"))({}), close: noop }),
  openRewriterValue((rewriter, handler) => rewriter.on("p", { element: handler })),
  openRewriterValue((rewriter, handler) => rewriter.on("p", { comments: handler })),
  openRewriterValue((rewriter, handler) => rewriter.on("p", { text: handler })),
  openRewriterValue((rewriter, handler) => rewriter.on("p", { element: element => element.onEndTag(handler) })),
  openRewriterValue((rewriter, handler) => rewriter.on("p", { element: element => handler(element.attributes) })),
  openRewriterValue((rewriter, handler) => rewriter.onDocument({ doctype: handler })),
  openRewriterValue((rewriter, handler) => rewriter.onDocument({ end: handler })),
  openBuildArtifact,
  instanceOf("BuildMessage", openBuildMessage),
  instanceOf("ResolveMessage", openResolveMessage),
  () => ({ value: jestOf().expect({ a: 1 }), close: noop }),
  () => ({ value: jestOf().expect.not, close: noop }),
  () => ({ value: jestOf().expectTypeOf({ a: 1 }), close: noop }),
  () => ({ value: jestOf().test.skip, close: noop }),
  () => ({ value: crypto, close: noop }),
  () => ({ value: new Bun.Transpiler(), close: noop }),
  () => ({ value: new Bun.Glob("*.txt"), close: noop }),
  () => ({ value: new Bun.ArrayBufferSink(), close: noop }),
  openNetworkSink,
  openReadableSinkController,
  () => ({ value: new Bun.CryptoHasher("sha256"), close: noop }),
  () => ({ value: openRouter(), close: noop }),
  () => ({ value: openRouter().match("/")!, close: noop }),
  () => ({ value: new Bun.Archive({ "a.txt": "text" }), close: noop }),
  () => ({ value: new Bun.Image(Buffer.from(pixel, "base64")), close: noop }),
  openTerminal,
  openCronJob,
  () => ({ value: new SourceMap({ version: 3, sources: ["a.js"], names: [], mappings: "AAAA", file: "b.js", sourceRoot: "" }), close: noop }),
  openMatcherContext(context => context),
  openMatcherContext(context => context.utils),
  () => ({ value: (jestOf().expect.extend({ nativeContractAsymmetric: () => ({ pass: true, message: () => "" }) }), jestOf().expect.nativeContractAsymmetric()), close: noop }),
];

// Makes one of each, tells the realm their prototypes, and adds the candidates.
export async function addHostInstances(
  realm: Realm,
  candidates: Candidate[] = everyCandidate,
  otherOpeners: readonly Open[] = [],
): Promise<string[]> {
  const failures: string[] = [];
  writeFileSync("native-contract-scratch.txt", "text");
  for (const [index, open] of [...openers, ...otherOpeners].entries()) {
    try {
      const first = await open(realm);
      const token = ("className" in open ? open.className : undefined) ?? realm.classesOf(first.value)[0];
      const prototypeEntry = realm.table.entries.get(realm.table.classes.get(token)?.prototype ?? "");
      if (prototypeEntry && realm.valueOf(prototypeEntry.token) === undefined) realm.register(prototypeEntry.path, Reflect.getPrototypeOf(first.value));
      await first.close();
      if (token === undefined || token === "Object") failures.push(`opener ${index}: the table has no class for what it makes`);
      else if (!everyCandidate.some(candidate => candidate.instanceOf === token)) candidates.push(hostCandidate(realm, token, open));
    } catch (error) {
      failures.push(`opener ${index}: ${String(error).slice(0, 160)}`);
    }
  }
  return failures;
}
