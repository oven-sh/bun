// Sockets, requests, responses, servers and streams are frozen, sealed or closed to new properties, themselves or through Proxies with and without traps, are asked what they hold, and are then used to the end. Closing an object through a Proxy must do what closing the object does.
import { once } from "node:events";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { Duplex, PassThrough, Readable, Writable } from "node:stream";

const levels = {
  "nothing": (_object: object) => {},
  "freeze": (object: object) => void Object.freeze(object),
  "seal": (object: object) => void Object.seal(object),
  "preventExtensions": (object: object) => void Object.preventExtensions(object),
};
type Level = keyof typeof levels;

const trapNames = [
  "defineProperty",
  "deleteProperty",
  "get",
  "getOwnPropertyDescriptor",
  "getPrototypeOf",
  "has",
  "isExtensible",
  "ownKeys",
  "preventExtensions",
  "set",
] as const;
type TrapName = (typeof trapNames)[number];

let trapped: string[] = [];

function makeHandler(names: readonly TrapName[]): ProxyHandler<object> {
  const handler: Record<string, unknown> = {};
  for (const name of names) {
    const forward = Reflect[name] as (...given: unknown[]) => unknown;
    handler[name] = (...given: unknown[]) => {
      trapped.push(typeof given[1] === "symbol" || typeof given[1] === "string" ? `${name} ${String(given[1])}` : name);
      return forward(...given);
    };
  }
  return handler;
}

function revoked(object: object) {
  const { proxy, revoke } = Proxy.revocable(object, {});
  revoke();
  return proxy;
}

const wrappers: Record<string, (object: object) => object> = {
  "itself": object => object,
  "a Proxy": object => new Proxy(object, {}),
  "a Proxy of a Proxy": object => new Proxy(new Proxy(object, {}), {}),
  "a Proxy with every trap": object => new Proxy(object, makeHandler(trapNames)),
  "a Proxy with every trap of a Proxy with every trap": object =>
    new Proxy(new Proxy(object, makeHandler(trapNames)), makeHandler(trapNames)),
  "a revoked Proxy": revoked,
  "a Proxy of a revoked Proxy": object => new Proxy(revoked(object), {}),
};
for (const name of trapNames) wrappers[`a Proxy that traps ${name}`] = object => new Proxy(object, makeHandler([name]));

let lines: string[] = [];
const say = (...parts: unknown[]) => void lines.push(parts.map(String).join(" "));
const tell = (error: unknown) =>
  `${(error as Error)?.name} in ${(error as Error)?.stack?.split("\n")[1]?.trim().split(" ")[1]}`;

process.on("uncaughtException", error => say("nobody caught", tell(error)));

function watch(label: string, emitter: NodeJS.EventEmitter, events: string[]) {
  for (const event of events)
    emitter.on(event, (value?: unknown) => say(label, event, value instanceof Error ? tell(value) : ""));
}

function attempt(label: string, operation: () => unknown) {
  try {
    return operation();
  } catch (error) {
    say(label, "threw", (error as Error).name);
  }
}

function describeState(object: object) {
  return `${Object.isExtensible(object) ? "open" : "closed"}${Object.isSealed(object) ? " sealed" : ""}${Object.isFrozen(object) ? " frozen" : ""}`;
}

function describeKeys(object: object) {
  const keys = Reflect.ownKeys(object);
  const descriptors = Object.getOwnPropertyDescriptors(object) as Record<PropertyKey, PropertyDescriptor>;
  let writable = 0;
  let configurable = 0;
  let found = 0;
  for (const key of keys) {
    const descriptor = Reflect.getOwnPropertyDescriptor(object, key)!;
    if (descriptor.writable) writable++;
    if (descriptor.configurable) configurable++;
    if (key in object && Object.hasOwn(object, key) && descriptors[key] !== undefined) found++;
  }
  return `${keys.length} keys, ${found} found, ${writable} writable, ${configurable} configurable`;
}

/** Closes the object as the case says and asks it, and what stands for it, what they hold. Returns what stands for it. */
function close(level: Level, wrapper: string, object: object) {
  const wrapped = wrappers[wrapper](object);
  trapped = [];
  attempt("closing", () => levels[level](wrapped));
  const seen = trapped;
  trapped = [];
  const listed = new Set(Reflect.ownKeys(object).map(String));
  say(
    "traps while closing:",
    seen.length,
    "of them for a key that is not listed:",
    seen.filter(entry => entry.includes(" ") && !listed.has(entry.slice(entry.indexOf(" ") + 1))).length,
  );
  say("itself", describeState(object), describeKeys(object));
  attempt("asking", () => say("as that", describeState(wrapped), describeKeys(wrapped)));
  attempt("changing", () => {
    const key = Reflect.ownKeys(object)[0];
    say(
      "defined anew",
      Reflect.defineProperty(wrapped, key, { enumerable: Reflect.getOwnPropertyDescriptor(object, key)!.enumerable }),
      "added",
      Reflect.defineProperty(wrapped, "added by the program", { value: 1, configurable: true }),
      "removed",
      Reflect.deleteProperty(wrapped, "added by the program"),
      "absent removed",
      Reflect.deleteProperty(wrapped, "never there"),
      "absent found",
      "never there" in wrapped,
    );
  });
  return wrapped;
}

// What did not come for an object closed itself is waited for only briefly where the object is closed in the same way through something else.
let family = "";
const neverCame = new Set<string>();

function withinReason<T>(label: string, promise: Promise<T>) {
  const key = `${family}|${label}`;
  let timer: ReturnType<typeof setTimeout>;
  const late = new Promise<void>(resolve => {
    timer = setTimeout(() => (neverCame.add(key), say(label, "did not come"), resolve()), neverCame.has(key) ? 250 : 4000);
  });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

const turns = () => new Promise<void>(resolve => setImmediate(() => setImmediate(() => setImmediate(resolve))));

type Closer = <T extends object>(object: T) => T;

const kinds: Record<string, (close: Closer) => Promise<void>> = {};

for (const target of ["socket", "request", "response"] as const) {
  for (const moment of ["before", "after"] as const) {
    kinds[`a server's ${target}, ${moment} the answer`] = async close => {
      const closed = Promise.withResolvers<void>();
      const server = http.createServer((givenRequest, givenResponse) => {
        let request = givenRequest;
        let response = givenResponse;
        let socket = request.socket;
        watch("socket", socket, ["error", "timeout"]);
        socket.on("close", () => (say("socket close"), closed.resolve()));
        watch("request", request, ["close", "error", "end"]);
        watch("response", response, ["close", "error", "finish"]);
        const closeChosen = () => {
          if (target === "socket") socket = close(socket);
          else if (target === "request") request = close(request);
          else response = close(response);
        };
        try {
          if (moment === "before") closeChosen();
          request.resume();
          socket.setTimeout(60_000);
          response.setHeader("x-a", "1");
          response.end("answer");
          if (moment === "after") closeChosen();
        } catch (error) {
          say("the listener threw", tell(error));
          givenRequest.socket.destroy();
        }
      });
      await once(server.listen(0, "127.0.0.1"), "listening");
      const { port } = server.address() as AddressInfo;
      await withinReason(
        "the answer",
        fetch(`http://127.0.0.1:${port}/`, { method: "POST", body: "body" }).then(
          async answer => say("answered", answer.status, answer.headers.get("x-a"), await answer.text()),
          error => say("the client saw", (error as Error).name),
        ),
      );
      await turns();
      server.closeAllConnections();
      server.close();
      await withinReason("the socket's close", closed.promise);
      await turns();
    };
  }
}

for (const target of ["request", "response", "socket"] as const) {
  kinds[`a client's ${target}`] = async close => {
    const server = http.createServer(
      (request, response) => void request.resume().on("end", () => response.end("answer")),
    );
    await once(server.listen(0, "127.0.0.1"), "listening");
    const { port } = server.address() as AddressInfo;
    const ended = Promise.withResolvers<void>();
    let request = http.request({ port, host: "127.0.0.1", method: "POST", agent: false }, givenResponse => {
      let response = givenResponse;
      watch("response", response, ["error", "end"]);
      response.on("close", () => (say("response close"), ended.resolve()));
      if (target === "response") response = close(response);
      if (target === "socket") close(response.socket);
      attempt("reading", () => response.resume());
    });
    watch("request", request, ["close", "error", "finish"]);
    request.end("body");
    if (target === "request") request = close(request);
    await withinReason("the response's close", ended.promise);
    await turns();
    server.closeAllConnections();
    await withinReason("the server's close", new Promise<void>(resolve => void server.close(() => resolve())));
  };
}

kinds["a server"] = async close => {
  let server = http.createServer((_request, response) => void response.end("answer"));
  watch("server", server, ["close", "error"]);
  await once(server.listen(0, "127.0.0.1"), "listening");
  const { port } = server.address() as AddressInfo;
  server = close(server);
  await withinReason(
    "the answer",
    fetch(`http://127.0.0.1:${port}/`).then(
      async answer => say("answered", await answer.text()),
      error => say("the client saw", (error as Error).name),
    ),
  );
  attempt("closing the connections", () => server.closeAllConnections());
  await withinReason(
    "the server's close",
    new Promise<void>(resolve => void attempt("closing the server", () => server.close(() => resolve()))),
  );
};

const streams: Record<string, () => Readable | Writable> = {
  "a readable stream": () => Readable.from(["a", "b"]),
  "a stream that passes through": () => new PassThrough(),
  "a duplex stream": () =>
    new Duplex({
      read() {
        this.push(null);
      },
      write(_chunk, _encoding, callback) {
        callback();
      },
    }),
  "a writable stream": () =>
    new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    }),
};
for (const [name, make] of Object.entries(streams)) {
  kinds[name] = async close => {
    const given = make();
    watch("stream", given, ["close", "end", "error", "finish"]);
    const stream = close(given);
    attempt("using", () => {
      if (stream instanceof Writable || stream instanceof Duplex) (stream as Writable).end("x");
      if (stream instanceof Readable) stream.resume();
    });
    await turns();
    await turns();
  };
}

// An exchange whose parts are frozen this early does not come to an end.
const endlessWhenFrozen = new Set([
  "a server's socket, before the answer",
  "a server's response, before the answer",
  "a client's request",
  "a client's socket",
  "a server",
]);
const alsoUsedInPlaceOfTheObject = new Set(["a Proxy", "a Proxy with every trap"]);

const rows = new Map<string, string>();

for (const kind of Object.keys(kinds)) {
  for (const level of Object.keys(levels) as Level[]) {
    if (level === "freeze" && endlessWhenFrozen.has(kind)) continue;
    for (const wrapper of Object.keys(wrappers)) {
      if (level === "nothing" && wrapper !== "itself") continue;
      for (const usesWrapped of alsoUsedInPlaceOfTheObject.has(wrapper) ? [false, true] : [false]) {
        lines = [];
        family = `${kind}|${level}`;
        let asked: string[] = [];
        await kinds[kind](<T extends object>(object: T) => {
          const before = lines.length;
          const wrapped = close(level, wrapper, object) as T;
          asked = lines.splice(before);
          return usesWrapped ? wrapped : object;
        });
        const title = `${kind}: ${level} ${wrapper}, then used ${usesWrapped ? "as that" : "itself"}`;
        console.log(`== ${title}\n${asked.join("\n")}\n-- ${lines.join(" | ")}`);
        if (!usesWrapped) rows.set(`${kind}|${level}|${wrapper}`, lines.join(" | "));
      }
    }
  }
}

let unlike = 0;
for (const [key, row] of rows) {
  const [kind, level, wrapper] = key.split("|");
  const expected = rows.get(`${kind}|${wrapper.includes("revoked") ? "nothing" : level}|itself`);
  if (row === expected) continue;
  unlike++;
  console.log(`UNLIKE: ${key}\n  ${row}\n  ${expected}`);
}
console.log(rows.size, "cases,", unlike, "unlike the object closed itself");
process.exitCode = unlike ? 1 : 0;
