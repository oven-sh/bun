// Instances that only Bun's own modules hold.
import { Readable } from "node:stream";
import { bindingOf, type Open } from "../native-contract/host-instances";
import { Unavailable } from "./instances";

const noop = () => {};
const millisecondsToBeCalled = 2000;

// A method of the class is replaced for as long as it takes the library to call it on an instance.
function receiverOf(prototypePath: string, method: string, provoke: () => unknown): Open {
  return async realm => {
    const prototype: object = bindingOf(realm, prototypePath);
    const descriptor = Reflect.getOwnPropertyDescriptor(prototype, method);
    if (typeof descriptor?.value !== "function") throw new Unavailable(`${prototypePath} has no method ${method}`);
    const { promise, resolve, reject } = Promise.withResolvers<object>();
    const timer = setTimeout(reject, millisecondsToBeCalled, new Unavailable(`nobody called ${prototypePath}.${method}`));
    const replacement = function (this: object, ...args: unknown[]) {
      resolve(this);
      return Reflect.apply(descriptor.value, this, args);
    };
    Reflect.defineProperty(prototype, method, { ...descriptor, value: replacement });
    try {
      await provoke();
      return { value: await promise, close: noop };
    } finally {
      clearTimeout(timer);
      Reflect.defineProperty(prototype, method, descriptor);
    }
  };
}

// node:stream reads a stream of native code through the handle of its source.
function sourceOf(className: string, createStream: () => ReadableStream | Promise<ReadableStream>): Open {
  return receiverOf(`%${className}InternalReadableStreamSource%.prototype`, "start", async () => {
    Readable.fromWeb((await createStream()) as any).read();
  });
}

async function createStreamOfResponse(): Promise<ReadableStream> {
  const server = Bun.serve({ port: 0, fetch: () => new Response(new ReadableStream({ type: "direct", pull: controller => void controller.write("text") } as any)) });
  try {
    return (await fetch(`http://localhost:${server.port}/`)).body!;
  } finally {
    void server.stop();
  }
}

// It stays in the handshake with a listener that says nothing.
const openPostgresConnection: Open = realm => {
  const listener = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data: noop, open: noop, close: noop, error: noop } });
  const { createConnection } = bindingOf(realm, "native:Bindgen:postgres.bind.ts:binding");
  const connection = createConnection("127.0.0.1", listener.port, "user", "password", "database", 0, null, "", "", noop, noop, 0, 0, 0, false, false, undefined, false, 0, undefined, "");
  return {
    value: connection,
    close() {
      connection.close();
      listener.stop(true);
    },
  };
};

const openMySQLConnection: Open = realm => {
  const listener = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data: noop, open: noop, close: noop, error: noop } });
  const { createConnection } = bindingOf(realm, "native:Bindgen:mysql.bind.ts:binding");
  const connection = createConnection("127.0.0.1", listener.port, "user", "password", "database", 0, null, "", "", noop, noop, 0, 0, 0, false, false, undefined, false, 0, undefined);
  return {
    value: connection,
    close() {
      connection.close();
      listener.stop(true);
    },
  };
};

// A query that no connection has run. Native code settles a query through what the library's module hands it when it is loaded.
function openQuery(adapter: "postgres" | "mysql"): Open {
  return realm => {
    void new Bun.SQL(`${adapter}://user@127.0.0.1:1/database`);
    const { createQuery } = bindingOf(realm, `native:Bindgen:${adapter}.bind.ts:binding`);
    return { value: createQuery("select 1", [], [], false, false), close: noop };
  };
}

export const openersOfWhatTheLibraryHolds: Open[] = [
  receiverOf("%ParsedShellScript%.prototype", "setEnv", () => void Bun.$`true`.env({})),
  sourceOf("Blob", () => new Blob(["text"]).stream()),
  sourceOf("File", () => Bun.file("native-contract-scratch.txt").stream()),
  sourceOf("Bytes", createStreamOfResponse),
  openPostgresConnection,
  openMySQLConnection,
  openQuery("postgres"),
  openQuery("mysql"),
];
