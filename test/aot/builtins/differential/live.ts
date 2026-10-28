// Instances that only a running server or an open connection gives: each set gets its own.
import { everyCandidate, operandOrigin, Unavailable, type Candidate } from "./instances";
import type { Realm } from "./members";

type Connection = { value: object; close(): void };

function liveCandidate(instanceOf: string, open: () => Promise<Connection>): Candidate {
  let current: Connection | undefined;
  return {
    name: `live:${instanceOf}`,
    kind: "Pristine",
    instanceOf,
    async prepare() {
      current = await open();
    },
    create(log, operand) {
      if (!current) throw new Unavailable(`no ${instanceOf} is open`);
      log.identify(current.value, operandOrigin(operand));
      return current.value;
    },
    release() {
      current?.close();
      current = undefined;
    },
  };
}

function createServer(onRequest: (request: Request) => void, onOpen: (socket: object) => void) {
  return Bun.serve({
    port: 0,
    fetch(request, server) {
      if (new URL(request.url).pathname === "/socket" && server.upgrade(request, { data: { tag: 1 } })) return undefined;
      return new Response("ok");
    },
    routes: {
      "/route/:id": request => {
        onRequest(request);
        return new Response("ok");
      },
    },
    websocket: { open: onOpen, message() {}, close() {} },
  });
}

// The method is read at once: the call that is checked may give the value another prototype.
function closerOf<T extends object>(value: T, name: keyof T, ...args: unknown[]): () => void {
  const method = value[name] as Function;
  return () => void Reflect.apply(method, value, args);
}

async function openServer(): Promise<Connection> {
  const server = createServer(() => {}, () => {});
  return { value: server, close: closerOf(server, "stop", true) };
}

async function openRequest(): Promise<Connection> {
  const { promise, resolve } = Promise.withResolvers<Request>();
  const server = createServer(resolve, () => {});
  await fetch(`http://localhost:${server.port}/route/7?a=1`, { headers: { cookie: "a=1" } });
  return { value: await promise, close: closerOf(server, "stop", true) };
}

async function openServerWebSocket(): Promise<Connection> {
  const { promise, resolve } = Promise.withResolvers<object>();
  const server = createServer(() => {}, resolve);
  const client = new WebSocket(`ws://localhost:${server.port}/socket`);
  const stop = closerOf(server, "stop", true);
  return {
    value: await promise,
    close() {
      client.close();
      stop();
    },
  };
}

async function openSocket(): Promise<{ listener: Bun.TCPSocketListener; accepted: object; close(): void }> {
  const { promise, resolve } = Promise.withResolvers<object>();
  const handlers = { data() {}, close() {}, error() {} };
  const listener = Bun.listen({ hostname: "localhost", port: 0, data: { tag: 2 }, socket: { ...handlers, open: resolve } });
  const client = await Bun.connect({ hostname: "localhost", port: listener.port, socket: { ...handlers, open() {} } });
  const stop = closerOf(listener, "stop", true);
  return {
    listener,
    accepted: await promise,
    close() {
      client.end();
      stop();
    },
  };
}

// Makes one of each, tells the realm their prototypes, which have no path from the global object, and adds the candidates.
export async function addLiveCandidates(realm: Realm): Promise<void> {
  const openers: (() => Promise<Connection>)[] = [
    openServer,
    openRequest,
    openServerWebSocket,
    async () => {
      const { accepted, close } = await openSocket();
      return { value: accepted, close };
    },
    async () => {
      const { listener, close } = await openSocket();
      return { value: listener, close };
    },
  ];
  for (const open of openers) {
    const first = await open();
    const [token] = realm.classesOf(first.value);
    const prototype = Reflect.getPrototypeOf(first.value)!;
    first.close();
    if (token === undefined) continue;
    realm.register(`%${token}%.prototype`, prototype);
    realm.register(`%${token}%`, Reflect.get(prototype, "constructor"));
    everyCandidate.push(liveCandidate(token, open));
  }
}
