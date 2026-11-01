// Sockets, requests, responses, servers and streams are frozen, sealed or closed to new properties, themselves or through Proxies with and without traps, are asked what they hold, and are then used to the end. Closing an object through a Proxy must do what closing the object does.
// Collections: not forced: it runs for over a minute so, longer than the 60 s after which its sockets time out
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
// The wait begins again with everything that is heard: on a slow machine the other events of the case are still on their way.
let family = "";
const neverCame = new Set<string>();

function withinReason<T>(label: string, promise: Promise<T>) {
  const key = `${family}|${label}`;
  let timer: ReturnType<typeof setTimeout>;
  const late = new Promise<void>(resolve => {
    const wait = neverCame.has(key) ? 250 : 4000;
    let heard = lines.length;
    const giveUp = () => {
      if (lines.length === heard) return (neverCame.add(key), say(label, "did not come"), resolve());
      heard = lines.length;
      timer = setTimeout(giveUp, wait);
    };
    timer = setTimeout(giveUp, wait);
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
/* Output:
== a server's socket, before the answer: nothing itself, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself open 60 keys, 60 found, 60 writable, 60 configurable
as that open 60 keys, 60 found, 60 writable, 60 configurable
defined anew true added true removed true absent removed true absent found false
-- response finish  | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's socket, before the answer: seal itself, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 60 keys, 60 found, 60 writable, 0 configurable
as that closed sealed 60 keys, 60 found, 60 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- the listener threw TypeError in setTimeout | request end  | request close  | response close  | socket close | the client saw TypeError
== a server's socket, before the answer: seal a Proxy, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 60 keys, 60 found, 60 writable, 0 configurable
as that closed sealed 60 keys, 60 found, 60 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- the listener threw TypeError in setTimeout | request end  | request close  | response close  | socket close | the client saw TypeError
== a server's socket, before the answer: seal a Proxy, then used as that
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 60 keys, 60 found, 60 writable, 0 configurable
as that closed sealed 60 keys, 60 found, 60 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- the listener threw TypeError in setTimeout | request end  | request close  | response close  | socket close | the client saw TypeError
== a server's socket, before the answer: seal a Proxy of a Proxy, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 60 keys, 60 found, 60 writable, 0 configurable
as that closed sealed 60 keys, 60 found, 60 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- the listener threw TypeError in setTimeout | request end  | request close  | response close  | socket close | the client saw TypeError
== a server's socket, before the answer: seal a Proxy with every trap, then used itself
traps while closing: 62 of them for a key that is not listed: 0
itself closed sealed 60 keys, 60 found, 60 writable, 0 configurable
as that closed sealed 60 keys, 60 found, 60 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- the listener threw TypeError in setTimeout | request end  | request close  | response close  | socket close | the client saw TypeError
== a server's socket, before the answer: seal a Proxy with every trap, then used as that
traps while closing: 62 of them for a key that is not listed: 0
itself closed sealed 60 keys, 60 found, 60 writable, 0 configurable
as that closed sealed 60 keys, 60 found, 60 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- the listener threw TypeError in setTimeout | request end  | request close  | response close  | socket close | the client saw TypeError
== a server's socket, before the answer: seal a Proxy with every trap of a Proxy with every trap, then used itself
traps while closing: 307 of them for a key that is not listed: 0
itself closed sealed 60 keys, 60 found, 60 writable, 0 configurable
as that closed sealed 60 keys, 60 found, 60 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- the listener threw TypeError in setTimeout | request end  | request close  | response close  | socket close | the client saw TypeError
== a server's socket, before the answer: seal a revoked Proxy, then used itself
closing threw TypeError
traps while closing: 0 of them for a key that is not listed: 0
itself open 60 keys, 60 found, 60 writable, 60 configurable
asking threw TypeError
changing threw TypeError
-- response finish  | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's socket, before the answer: seal a Proxy of a revoked Proxy, then used itself
closing threw TypeError
traps while closing: 0 of them for a key that is not listed: 0
itself open 60 keys, 60 found, 60 writable, 60 configurable
asking threw TypeError
changing threw TypeError
-- response finish  | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's socket, before the answer: seal a Proxy that traps defineProperty, then used itself
traps while closing: 60 of them for a key that is not listed: 0
itself closed sealed 60 keys, 60 found, 60 writable, 0 configurable
as that closed sealed 60 keys, 60 found, 60 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- the listener threw TypeError in setTimeout | request end  | request close  | response close  | socket close | the client saw TypeError
== a server's socket, before the answer: seal a Proxy that traps deleteProperty, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 60 keys, 60 found, 60 writable, 0 configurable
as that closed sealed 60 keys, 60 found, 60 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- the listener threw TypeError in setTimeout | request end  | request close  | response close  | socket close | the client saw TypeError
== a server's socket, before the answer: seal a Proxy that traps get, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 60 keys, 60 found, 60 writable, 0 configurable
as that closed sealed 60 keys, 60 found, 60 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- the listener threw TypeError in setTimeout | request end  | request close  | response close  | socket close | the client saw TypeError
== a server's socket, before the answer: seal a Proxy that traps getOwnPropertyDescriptor, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 60 keys, 60 found, 60 writable, 0 configurable
as that closed sealed 60 keys, 60 found, 60 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- the listener threw TypeError in setTimeout | request end  | request close  | response close  | socket close | the client saw TypeError
== a server's socket, before the answer: seal a Proxy that traps getPrototypeOf, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 60 keys, 60 found, 60 writable, 0 configurable
as that closed sealed 60 keys, 60 found, 60 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- the listener threw TypeError in setTimeout | request end  | request close  | response close  | socket close | the client saw TypeError
== a server's socket, before the answer: seal a Proxy that traps has, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 60 keys, 60 found, 60 writable, 0 configurable
as that closed sealed 60 keys, 60 found, 60 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- the listener threw TypeError in setTimeout | request end  | request close  | response close  | socket close | the client saw TypeError
== a server's socket, before the answer: seal a Proxy that traps isExtensible, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 60 keys, 60 found, 60 writable, 0 configurable
as that closed sealed 60 keys, 60 found, 60 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- the listener threw TypeError in setTimeout | request end  | request close  | response close  | socket close | the client saw TypeError
== a server's socket, before the answer: seal a Proxy that traps ownKeys, then used itself
traps while closing: 1 of them for a key that is not listed: 0
itself closed sealed 60 keys, 60 found, 60 writable, 0 configurable
as that closed sealed 60 keys, 60 found, 60 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- the listener threw TypeError in setTimeout | request end  | request close  | response close  | socket close | the client saw TypeError
== a server's socket, before the answer: seal a Proxy that traps preventExtensions, then used itself
traps while closing: 1 of them for a key that is not listed: 0
itself closed sealed 60 keys, 60 found, 60 writable, 0 configurable
as that closed sealed 60 keys, 60 found, 60 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- the listener threw TypeError in setTimeout | request end  | request close  | response close  | socket close | the client saw TypeError
== a server's socket, before the answer: seal a Proxy that traps set, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 60 keys, 60 found, 60 writable, 0 configurable
as that closed sealed 60 keys, 60 found, 60 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- the listener threw TypeError in setTimeout | request end  | request close  | response close  | socket close | the client saw TypeError
== a server's socket, before the answer: preventExtensions itself, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 60 keys, 60 found, 60 writable, 60 configurable
as that closed 60 keys, 60 found, 60 writable, 60 configurable
defined anew true added false removed true absent removed true absent found false
-- the listener threw TypeError in setTimeout | request end  | request close  | response close  | socket close | the client saw TypeError
== a server's socket, before the answer: preventExtensions a Proxy, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 60 keys, 60 found, 60 writable, 60 configurable
as that closed 60 keys, 60 found, 60 writable, 60 configurable
defined anew true added false removed true absent removed true absent found false
-- the listener threw TypeError in setTimeout | request end  | request close  | response close  | socket close | the client saw TypeError
== a server's socket, before the answer: preventExtensions a Proxy, then used as that
traps while closing: 0 of them for a key that is not listed: 0
itself closed 60 keys, 60 found, 60 writable, 60 configurable
as that closed 60 keys, 60 found, 60 writable, 60 configurable
defined anew true added false removed true absent removed true absent found false
-- the listener threw TypeError in setTimeout | request end  | request close  | response close  | socket close | the client saw TypeError
== a server's socket, before the answer: preventExtensions a Proxy of a Proxy, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 60 keys, 60 found, 60 writable, 60 configurable
as that closed 60 keys, 60 found, 60 writable, 60 configurable
defined anew true added false removed true absent removed true absent found false
-- the listener threw TypeError in setTimeout | request end  | request close  | response close  | socket close | the client saw TypeError
== a server's socket, before the answer: preventExtensions a Proxy with every trap, then used itself
traps while closing: 1 of them for a key that is not listed: 0
itself closed 60 keys, 60 found, 60 writable, 60 configurable
as that closed 60 keys, 60 found, 60 writable, 60 configurable
defined anew true added false removed true absent removed true absent found false
-- the listener threw TypeError in setTimeout | request end  | request close  | response close  | socket close | the client saw TypeError
== a server's socket, before the answer: preventExtensions a Proxy with every trap, then used as that
traps while closing: 1 of them for a key that is not listed: 0
itself closed 60 keys, 60 found, 60 writable, 60 configurable
as that closed 60 keys, 60 found, 60 writable, 60 configurable
defined anew true added false removed true absent removed true absent found false
-- the listener threw TypeError in setTimeout | request end  | request close  | response close  | socket close | the client saw TypeError
== a server's socket, before the answer: preventExtensions a Proxy with every trap of a Proxy with every trap, then used itself
traps while closing: 3 of them for a key that is not listed: 0
itself closed 60 keys, 60 found, 60 writable, 60 configurable
as that closed 60 keys, 60 found, 60 writable, 60 configurable
defined anew true added false removed true absent removed true absent found false
-- the listener threw TypeError in setTimeout | request end  | request close  | response close  | socket close | the client saw TypeError
== a server's socket, before the answer: preventExtensions a revoked Proxy, then used itself
closing threw TypeError
traps while closing: 0 of them for a key that is not listed: 0
itself open 60 keys, 60 found, 60 writable, 60 configurable
asking threw TypeError
changing threw TypeError
-- response finish  | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's socket, before the answer: preventExtensions a Proxy of a revoked Proxy, then used itself
closing threw TypeError
traps while closing: 0 of them for a key that is not listed: 0
itself open 60 keys, 60 found, 60 writable, 60 configurable
asking threw TypeError
changing threw TypeError
-- response finish  | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's socket, before the answer: preventExtensions a Proxy that traps defineProperty, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 60 keys, 60 found, 60 writable, 60 configurable
as that closed 60 keys, 60 found, 60 writable, 60 configurable
defined anew true added false removed true absent removed true absent found false
-- the listener threw TypeError in setTimeout | request end  | request close  | response close  | socket close | the client saw TypeError
== a server's socket, before the answer: preventExtensions a Proxy that traps deleteProperty, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 60 keys, 60 found, 60 writable, 60 configurable
as that closed 60 keys, 60 found, 60 writable, 60 configurable
defined anew true added false removed true absent removed true absent found false
-- the listener threw TypeError in setTimeout | request end  | request close  | response close  | socket close | the client saw TypeError
== a server's socket, before the answer: preventExtensions a Proxy that traps get, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 60 keys, 60 found, 60 writable, 60 configurable
as that closed 60 keys, 60 found, 60 writable, 60 configurable
defined anew true added false removed true absent removed true absent found false
-- the listener threw TypeError in setTimeout | request end  | request close  | response close  | socket close | the client saw TypeError
== a server's socket, before the answer: preventExtensions a Proxy that traps getOwnPropertyDescriptor, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 60 keys, 60 found, 60 writable, 60 configurable
as that closed 60 keys, 60 found, 60 writable, 60 configurable
defined anew true added false removed true absent removed true absent found false
-- the listener threw TypeError in setTimeout | request end  | request close  | response close  | socket close | the client saw TypeError
== a server's socket, before the answer: preventExtensions a Proxy that traps getPrototypeOf, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 60 keys, 60 found, 60 writable, 60 configurable
as that closed 60 keys, 60 found, 60 writable, 60 configurable
defined anew true added false removed true absent removed true absent found false
-- the listener threw TypeError in setTimeout | request end  | request close  | response close  | socket close | the client saw TypeError
== a server's socket, before the answer: preventExtensions a Proxy that traps has, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 60 keys, 60 found, 60 writable, 60 configurable
as that closed 60 keys, 60 found, 60 writable, 60 configurable
defined anew true added false removed true absent removed true absent found false
-- the listener threw TypeError in setTimeout | request end  | request close  | response close  | socket close | the client saw TypeError
== a server's socket, before the answer: preventExtensions a Proxy that traps isExtensible, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 60 keys, 60 found, 60 writable, 60 configurable
as that closed 60 keys, 60 found, 60 writable, 60 configurable
defined anew true added false removed true absent removed true absent found false
-- the listener threw TypeError in setTimeout | request end  | request close  | response close  | socket close | the client saw TypeError
== a server's socket, before the answer: preventExtensions a Proxy that traps ownKeys, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 60 keys, 60 found, 60 writable, 60 configurable
as that closed 60 keys, 60 found, 60 writable, 60 configurable
defined anew true added false removed true absent removed true absent found false
-- the listener threw TypeError in setTimeout | request end  | request close  | response close  | socket close | the client saw TypeError
== a server's socket, before the answer: preventExtensions a Proxy that traps preventExtensions, then used itself
traps while closing: 1 of them for a key that is not listed: 0
itself closed 60 keys, 60 found, 60 writable, 60 configurable
as that closed 60 keys, 60 found, 60 writable, 60 configurable
defined anew true added false removed true absent removed true absent found false
-- the listener threw TypeError in setTimeout | request end  | request close  | response close  | socket close | the client saw TypeError
== a server's socket, before the answer: preventExtensions a Proxy that traps set, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 60 keys, 60 found, 60 writable, 60 configurable
as that closed 60 keys, 60 found, 60 writable, 60 configurable
defined anew true added false removed true absent removed true absent found false
-- the listener threw TypeError in setTimeout | request end  | request close  | response close  | socket close | the client saw TypeError
== a server's socket, after the answer: nothing itself, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself open 61 keys, 61 found, 61 writable, 61 configurable
as that open 61 keys, 61 found, 61 writable, 61 configurable
defined anew true added true removed true absent removed true absent found false
-- response finish  | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's socket, after the answer: freeze itself, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed frozen 61 keys, 61 found, 0 writable, 0 configurable
as that closed sealed frozen 61 keys, 61 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in <anonymous> | nobody caught TypeError in setTimeout | response close  | request end  | request close  | answered 200 1 answer | socket error TypeError in _destroy | socket close | nobody caught TypeError in releaseServerParserShim
== a server's socket, after the answer: freeze a Proxy, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed frozen 61 keys, 61 found, 0 writable, 0 configurable
as that closed sealed frozen 61 keys, 61 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in <anonymous> | nobody caught TypeError in setTimeout | response close  | request end  | request close  | answered 200 1 answer | socket error TypeError in _destroy | socket close | nobody caught TypeError in releaseServerParserShim
== a server's socket, after the answer: freeze a Proxy, then used as that
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed frozen 61 keys, 61 found, 0 writable, 0 configurable
as that closed sealed frozen 61 keys, 61 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in <anonymous> | nobody caught TypeError in setTimeout | response close  | request end  | request close  | answered 200 1 answer | socket error TypeError in _destroy | socket close | nobody caught TypeError in releaseServerParserShim
== a server's socket, after the answer: freeze a Proxy of a Proxy, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed frozen 61 keys, 61 found, 0 writable, 0 configurable
as that closed sealed frozen 61 keys, 61 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in <anonymous> | nobody caught TypeError in setTimeout | response close  | request end  | request close  | answered 200 1 answer | socket error TypeError in _destroy | socket close | nobody caught TypeError in releaseServerParserShim
== a server's socket, after the answer: freeze a Proxy with every trap, then used itself
traps while closing: 124 of them for a key that is not listed: 0
itself closed sealed frozen 61 keys, 61 found, 0 writable, 0 configurable
as that closed sealed frozen 61 keys, 61 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in <anonymous> | nobody caught TypeError in setTimeout | response close  | request end  | request close  | answered 200 1 answer | socket error TypeError in _destroy | socket close | nobody caught TypeError in releaseServerParserShim
== a server's socket, after the answer: freeze a Proxy with every trap, then used as that
traps while closing: 124 of them for a key that is not listed: 0
itself closed sealed frozen 61 keys, 61 found, 0 writable, 0 configurable
as that closed sealed frozen 61 keys, 61 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in <anonymous> | nobody caught TypeError in setTimeout | response close  | request end  | request close  | answered 200 1 answer | socket error TypeError in _destroy | socket close | nobody caught TypeError in releaseServerParserShim
== a server's socket, after the answer: freeze a Proxy with every trap of a Proxy with every trap, then used itself
traps while closing: 556 of them for a key that is not listed: 0
itself closed sealed frozen 61 keys, 61 found, 0 writable, 0 configurable
as that closed sealed frozen 61 keys, 61 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in <anonymous> | nobody caught TypeError in setTimeout | response close  | request end  | request close  | answered 200 1 answer | socket error TypeError in _destroy | socket close | nobody caught TypeError in releaseServerParserShim
== a server's socket, after the answer: freeze a revoked Proxy, then used itself
closing threw TypeError
traps while closing: 0 of them for a key that is not listed: 0
itself open 61 keys, 61 found, 61 writable, 61 configurable
asking threw TypeError
changing threw TypeError
-- response finish  | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's socket, after the answer: freeze a Proxy of a revoked Proxy, then used itself
closing threw TypeError
traps while closing: 0 of them for a key that is not listed: 0
itself open 61 keys, 61 found, 61 writable, 61 configurable
asking threw TypeError
changing threw TypeError
-- response finish  | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's socket, after the answer: freeze a Proxy that traps defineProperty, then used itself
traps while closing: 61 of them for a key that is not listed: 0
itself closed sealed frozen 61 keys, 61 found, 0 writable, 0 configurable
as that closed sealed frozen 61 keys, 61 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in <anonymous> | nobody caught TypeError in setTimeout | response close  | request end  | request close  | answered 200 1 answer | socket error TypeError in _destroy | socket close | nobody caught TypeError in releaseServerParserShim
== a server's socket, after the answer: freeze a Proxy that traps deleteProperty, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed frozen 61 keys, 61 found, 0 writable, 0 configurable
as that closed sealed frozen 61 keys, 61 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in <anonymous> | nobody caught TypeError in setTimeout | response close  | request end  | request close  | answered 200 1 answer | socket error TypeError in _destroy | socket close | nobody caught TypeError in releaseServerParserShim
== a server's socket, after the answer: freeze a Proxy that traps get, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed frozen 61 keys, 61 found, 0 writable, 0 configurable
as that closed sealed frozen 61 keys, 61 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in <anonymous> | nobody caught TypeError in setTimeout | response close  | request end  | request close  | answered 200 1 answer | socket error TypeError in _destroy | socket close | nobody caught TypeError in releaseServerParserShim
== a server's socket, after the answer: freeze a Proxy that traps getOwnPropertyDescriptor, then used itself
traps while closing: 61 of them for a key that is not listed: 0
itself closed sealed frozen 61 keys, 61 found, 0 writable, 0 configurable
as that closed sealed frozen 61 keys, 61 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in <anonymous> | nobody caught TypeError in setTimeout | response close  | request end  | request close  | answered 200 1 answer | socket error TypeError in _destroy | socket close | nobody caught TypeError in releaseServerParserShim
== a server's socket, after the answer: freeze a Proxy that traps getPrototypeOf, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed frozen 61 keys, 61 found, 0 writable, 0 configurable
as that closed sealed frozen 61 keys, 61 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in <anonymous> | nobody caught TypeError in setTimeout | response close  | request end  | request close  | answered 200 1 answer | socket error TypeError in _destroy | socket close | nobody caught TypeError in releaseServerParserShim
== a server's socket, after the answer: freeze a Proxy that traps has, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed frozen 61 keys, 61 found, 0 writable, 0 configurable
as that closed sealed frozen 61 keys, 61 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in <anonymous> | nobody caught TypeError in setTimeout | response close  | request end  | request close  | answered 200 1 answer | socket error TypeError in _destroy | socket close | nobody caught TypeError in releaseServerParserShim
== a server's socket, after the answer: freeze a Proxy that traps isExtensible, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed frozen 61 keys, 61 found, 0 writable, 0 configurable
as that closed sealed frozen 61 keys, 61 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in <anonymous> | nobody caught TypeError in setTimeout | response close  | request end  | request close  | answered 200 1 answer | socket error TypeError in _destroy | socket close | nobody caught TypeError in releaseServerParserShim
== a server's socket, after the answer: freeze a Proxy that traps ownKeys, then used itself
traps while closing: 1 of them for a key that is not listed: 0
itself closed sealed frozen 61 keys, 61 found, 0 writable, 0 configurable
as that closed sealed frozen 61 keys, 61 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in <anonymous> | nobody caught TypeError in setTimeout | response close  | request end  | request close  | answered 200 1 answer | socket error TypeError in _destroy | socket close | nobody caught TypeError in releaseServerParserShim
== a server's socket, after the answer: freeze a Proxy that traps preventExtensions, then used itself
traps while closing: 1 of them for a key that is not listed: 0
itself closed sealed frozen 61 keys, 61 found, 0 writable, 0 configurable
as that closed sealed frozen 61 keys, 61 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in <anonymous> | nobody caught TypeError in setTimeout | response close  | request end  | request close  | answered 200 1 answer | socket error TypeError in _destroy | socket close | nobody caught TypeError in releaseServerParserShim
== a server's socket, after the answer: freeze a Proxy that traps set, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed frozen 61 keys, 61 found, 0 writable, 0 configurable
as that closed sealed frozen 61 keys, 61 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in <anonymous> | nobody caught TypeError in setTimeout | response close  | request end  | request close  | answered 200 1 answer | socket error TypeError in _destroy | socket close | nobody caught TypeError in releaseServerParserShim
== a server's socket, after the answer: seal itself, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 61 keys, 61 found, 61 writable, 0 configurable
as that closed sealed 61 keys, 61 found, 61 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in onResponseFinishHandleSocket | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's socket, after the answer: seal a Proxy, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 61 keys, 61 found, 61 writable, 0 configurable
as that closed sealed 61 keys, 61 found, 61 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in onResponseFinishHandleSocket | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's socket, after the answer: seal a Proxy, then used as that
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 61 keys, 61 found, 61 writable, 0 configurable
as that closed sealed 61 keys, 61 found, 61 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in onResponseFinishHandleSocket | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's socket, after the answer: seal a Proxy of a Proxy, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 61 keys, 61 found, 61 writable, 0 configurable
as that closed sealed 61 keys, 61 found, 61 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in onResponseFinishHandleSocket | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's socket, after the answer: seal a Proxy with every trap, then used itself
traps while closing: 63 of them for a key that is not listed: 0
itself closed sealed 61 keys, 61 found, 61 writable, 0 configurable
as that closed sealed 61 keys, 61 found, 61 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in onResponseFinishHandleSocket | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's socket, after the answer: seal a Proxy with every trap, then used as that
traps while closing: 63 of them for a key that is not listed: 0
itself closed sealed 61 keys, 61 found, 61 writable, 0 configurable
as that closed sealed 61 keys, 61 found, 61 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in onResponseFinishHandleSocket | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's socket, after the answer: seal a Proxy with every trap of a Proxy with every trap, then used itself
traps while closing: 312 of them for a key that is not listed: 0
itself closed sealed 61 keys, 61 found, 61 writable, 0 configurable
as that closed sealed 61 keys, 61 found, 61 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in onResponseFinishHandleSocket | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's socket, after the answer: seal a revoked Proxy, then used itself
closing threw TypeError
traps while closing: 0 of them for a key that is not listed: 0
itself open 61 keys, 61 found, 61 writable, 61 configurable
asking threw TypeError
changing threw TypeError
-- response finish  | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's socket, after the answer: seal a Proxy of a revoked Proxy, then used itself
closing threw TypeError
traps while closing: 0 of them for a key that is not listed: 0
itself open 61 keys, 61 found, 61 writable, 61 configurable
asking threw TypeError
changing threw TypeError
-- response finish  | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's socket, after the answer: seal a Proxy that traps defineProperty, then used itself
traps while closing: 61 of them for a key that is not listed: 0
itself closed sealed 61 keys, 61 found, 61 writable, 0 configurable
as that closed sealed 61 keys, 61 found, 61 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in onResponseFinishHandleSocket | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's socket, after the answer: seal a Proxy that traps deleteProperty, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 61 keys, 61 found, 61 writable, 0 configurable
as that closed sealed 61 keys, 61 found, 61 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in onResponseFinishHandleSocket | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's socket, after the answer: seal a Proxy that traps get, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 61 keys, 61 found, 61 writable, 0 configurable
as that closed sealed 61 keys, 61 found, 61 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in onResponseFinishHandleSocket | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's socket, after the answer: seal a Proxy that traps getOwnPropertyDescriptor, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 61 keys, 61 found, 61 writable, 0 configurable
as that closed sealed 61 keys, 61 found, 61 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in onResponseFinishHandleSocket | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's socket, after the answer: seal a Proxy that traps getPrototypeOf, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 61 keys, 61 found, 61 writable, 0 configurable
as that closed sealed 61 keys, 61 found, 61 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in onResponseFinishHandleSocket | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's socket, after the answer: seal a Proxy that traps has, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 61 keys, 61 found, 61 writable, 0 configurable
as that closed sealed 61 keys, 61 found, 61 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in onResponseFinishHandleSocket | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's socket, after the answer: seal a Proxy that traps isExtensible, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 61 keys, 61 found, 61 writable, 0 configurable
as that closed sealed 61 keys, 61 found, 61 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in onResponseFinishHandleSocket | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's socket, after the answer: seal a Proxy that traps ownKeys, then used itself
traps while closing: 1 of them for a key that is not listed: 0
itself closed sealed 61 keys, 61 found, 61 writable, 0 configurable
as that closed sealed 61 keys, 61 found, 61 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in onResponseFinishHandleSocket | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's socket, after the answer: seal a Proxy that traps preventExtensions, then used itself
traps while closing: 1 of them for a key that is not listed: 0
itself closed sealed 61 keys, 61 found, 61 writable, 0 configurable
as that closed sealed 61 keys, 61 found, 61 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in onResponseFinishHandleSocket | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's socket, after the answer: seal a Proxy that traps set, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 61 keys, 61 found, 61 writable, 0 configurable
as that closed sealed 61 keys, 61 found, 61 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in onResponseFinishHandleSocket | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's socket, after the answer: preventExtensions itself, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 61 keys, 61 found, 61 writable, 61 configurable
as that closed 61 keys, 61 found, 61 writable, 61 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in onResponseFinishHandleSocket | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's socket, after the answer: preventExtensions a Proxy, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 61 keys, 61 found, 61 writable, 61 configurable
as that closed 61 keys, 61 found, 61 writable, 61 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in onResponseFinishHandleSocket | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's socket, after the answer: preventExtensions a Proxy, then used as that
traps while closing: 0 of them for a key that is not listed: 0
itself closed 61 keys, 61 found, 61 writable, 61 configurable
as that closed 61 keys, 61 found, 61 writable, 61 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in onResponseFinishHandleSocket | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's socket, after the answer: preventExtensions a Proxy of a Proxy, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 61 keys, 61 found, 61 writable, 61 configurable
as that closed 61 keys, 61 found, 61 writable, 61 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in onResponseFinishHandleSocket | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's socket, after the answer: preventExtensions a Proxy with every trap, then used itself
traps while closing: 1 of them for a key that is not listed: 0
itself closed 61 keys, 61 found, 61 writable, 61 configurable
as that closed 61 keys, 61 found, 61 writable, 61 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in onResponseFinishHandleSocket | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's socket, after the answer: preventExtensions a Proxy with every trap, then used as that
traps while closing: 1 of them for a key that is not listed: 0
itself closed 61 keys, 61 found, 61 writable, 61 configurable
as that closed 61 keys, 61 found, 61 writable, 61 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in onResponseFinishHandleSocket | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's socket, after the answer: preventExtensions a Proxy with every trap of a Proxy with every trap, then used itself
traps while closing: 3 of them for a key that is not listed: 0
itself closed 61 keys, 61 found, 61 writable, 61 configurable
as that closed 61 keys, 61 found, 61 writable, 61 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in onResponseFinishHandleSocket | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's socket, after the answer: preventExtensions a revoked Proxy, then used itself
closing threw TypeError
traps while closing: 0 of them for a key that is not listed: 0
itself open 61 keys, 61 found, 61 writable, 61 configurable
asking threw TypeError
changing threw TypeError
-- response finish  | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's socket, after the answer: preventExtensions a Proxy of a revoked Proxy, then used itself
closing threw TypeError
traps while closing: 0 of them for a key that is not listed: 0
itself open 61 keys, 61 found, 61 writable, 61 configurable
asking threw TypeError
changing threw TypeError
-- response finish  | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's socket, after the answer: preventExtensions a Proxy that traps defineProperty, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 61 keys, 61 found, 61 writable, 61 configurable
as that closed 61 keys, 61 found, 61 writable, 61 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in onResponseFinishHandleSocket | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's socket, after the answer: preventExtensions a Proxy that traps deleteProperty, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 61 keys, 61 found, 61 writable, 61 configurable
as that closed 61 keys, 61 found, 61 writable, 61 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in onResponseFinishHandleSocket | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's socket, after the answer: preventExtensions a Proxy that traps get, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 61 keys, 61 found, 61 writable, 61 configurable
as that closed 61 keys, 61 found, 61 writable, 61 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in onResponseFinishHandleSocket | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's socket, after the answer: preventExtensions a Proxy that traps getOwnPropertyDescriptor, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 61 keys, 61 found, 61 writable, 61 configurable
as that closed 61 keys, 61 found, 61 writable, 61 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in onResponseFinishHandleSocket | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's socket, after the answer: preventExtensions a Proxy that traps getPrototypeOf, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 61 keys, 61 found, 61 writable, 61 configurable
as that closed 61 keys, 61 found, 61 writable, 61 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in onResponseFinishHandleSocket | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's socket, after the answer: preventExtensions a Proxy that traps has, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 61 keys, 61 found, 61 writable, 61 configurable
as that closed 61 keys, 61 found, 61 writable, 61 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in onResponseFinishHandleSocket | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's socket, after the answer: preventExtensions a Proxy that traps isExtensible, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 61 keys, 61 found, 61 writable, 61 configurable
as that closed 61 keys, 61 found, 61 writable, 61 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in onResponseFinishHandleSocket | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's socket, after the answer: preventExtensions a Proxy that traps ownKeys, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 61 keys, 61 found, 61 writable, 61 configurable
as that closed 61 keys, 61 found, 61 writable, 61 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in onResponseFinishHandleSocket | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's socket, after the answer: preventExtensions a Proxy that traps preventExtensions, then used itself
traps while closing: 1 of them for a key that is not listed: 0
itself closed 61 keys, 61 found, 61 writable, 61 configurable
as that closed 61 keys, 61 found, 61 writable, 61 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in onResponseFinishHandleSocket | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's socket, after the answer: preventExtensions a Proxy that traps set, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 61 keys, 61 found, 61 writable, 61 configurable
as that closed 61 keys, 61 found, 61 writable, 61 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in onResponseFinishHandleSocket | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's request, before the answer: nothing itself, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself open 28 keys, 28 found, 28 writable, 28 configurable
as that open 28 keys, 28 found, 28 writable, 28 configurable
defined anew true added true removed true absent removed true absent found false
-- response finish  | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's request, before the answer: freeze itself, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed frozen 28 keys, 28 found, 0 writable, 0 configurable
as that closed sealed frozen 28 keys, 28 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in _dump | request error TypeError in _destroy | request close  | response close  | nobody caught TypeError in emitEOFIncomingMessage | answered 200 1 answer | socket close
== a server's request, before the answer: freeze a Proxy, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed frozen 28 keys, 28 found, 0 writable, 0 configurable
as that closed sealed frozen 28 keys, 28 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in _dump | request error TypeError in _destroy | request close  | response close  | nobody caught TypeError in emitEOFIncomingMessage | answered 200 1 answer | socket close
== a server's request, before the answer: freeze a Proxy, then used as that
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed frozen 28 keys, 28 found, 0 writable, 0 configurable
as that closed sealed frozen 28 keys, 28 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in _dump | request error TypeError in _destroy | request close  | response close  | nobody caught TypeError in emitEOFIncomingMessage | answered 200 1 answer | socket close
== a server's request, before the answer: freeze a Proxy of a Proxy, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed frozen 28 keys, 28 found, 0 writable, 0 configurable
as that closed sealed frozen 28 keys, 28 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in _dump | request error TypeError in _destroy | request close  | response close  | nobody caught TypeError in emitEOFIncomingMessage | answered 200 1 answer | socket close
== a server's request, before the answer: freeze a Proxy with every trap, then used itself
traps while closing: 58 of them for a key that is not listed: 0
itself closed sealed frozen 28 keys, 28 found, 0 writable, 0 configurable
as that closed sealed frozen 28 keys, 28 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in _dump | request error TypeError in _destroy | request close  | response close  | nobody caught TypeError in emitEOFIncomingMessage | answered 200 1 answer | socket close
== a server's request, before the answer: freeze a Proxy with every trap, then used as that
traps while closing: 58 of them for a key that is not listed: 0
itself closed sealed frozen 28 keys, 28 found, 0 writable, 0 configurable
as that closed sealed frozen 28 keys, 28 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in _dump | request error TypeError in _destroy | request close  | response close  | nobody caught TypeError in emitEOFIncomingMessage | answered 200 1 answer | socket close
== a server's request, before the answer: freeze a Proxy with every trap of a Proxy with every trap, then used itself
traps while closing: 259 of them for a key that is not listed: 0
itself closed sealed frozen 28 keys, 28 found, 0 writable, 0 configurable
as that closed sealed frozen 28 keys, 28 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in _dump | request error TypeError in _destroy | request close  | response close  | nobody caught TypeError in emitEOFIncomingMessage | answered 200 1 answer | socket close
== a server's request, before the answer: freeze a revoked Proxy, then used itself
closing threw TypeError
traps while closing: 0 of them for a key that is not listed: 0
itself open 28 keys, 28 found, 28 writable, 28 configurable
asking threw TypeError
changing threw TypeError
-- response finish  | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's request, before the answer: freeze a Proxy of a revoked Proxy, then used itself
closing threw TypeError
traps while closing: 0 of them for a key that is not listed: 0
itself open 28 keys, 28 found, 28 writable, 28 configurable
asking threw TypeError
changing threw TypeError
-- response finish  | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's request, before the answer: freeze a Proxy that traps defineProperty, then used itself
traps while closing: 28 of them for a key that is not listed: 0
itself closed sealed frozen 28 keys, 28 found, 0 writable, 0 configurable
as that closed sealed frozen 28 keys, 28 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in _dump | request error TypeError in _destroy | request close  | response close  | nobody caught TypeError in emitEOFIncomingMessage | answered 200 1 answer | socket close
== a server's request, before the answer: freeze a Proxy that traps deleteProperty, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed frozen 28 keys, 28 found, 0 writable, 0 configurable
as that closed sealed frozen 28 keys, 28 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in _dump | request error TypeError in _destroy | request close  | response close  | nobody caught TypeError in emitEOFIncomingMessage | answered 200 1 answer | socket close
== a server's request, before the answer: freeze a Proxy that traps get, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed frozen 28 keys, 28 found, 0 writable, 0 configurable
as that closed sealed frozen 28 keys, 28 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in _dump | request error TypeError in _destroy | request close  | response close  | nobody caught TypeError in emitEOFIncomingMessage | answered 200 1 answer | socket close
== a server's request, before the answer: freeze a Proxy that traps getOwnPropertyDescriptor, then used itself
traps while closing: 28 of them for a key that is not listed: 0
itself closed sealed frozen 28 keys, 28 found, 0 writable, 0 configurable
as that closed sealed frozen 28 keys, 28 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in _dump | request error TypeError in _destroy | request close  | response close  | nobody caught TypeError in emitEOFIncomingMessage | answered 200 1 answer | socket close
== a server's request, before the answer: freeze a Proxy that traps getPrototypeOf, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed frozen 28 keys, 28 found, 0 writable, 0 configurable
as that closed sealed frozen 28 keys, 28 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in _dump | request error TypeError in _destroy | request close  | response close  | nobody caught TypeError in emitEOFIncomingMessage | answered 200 1 answer | socket close
== a server's request, before the answer: freeze a Proxy that traps has, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed frozen 28 keys, 28 found, 0 writable, 0 configurable
as that closed sealed frozen 28 keys, 28 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in _dump | request error TypeError in _destroy | request close  | response close  | nobody caught TypeError in emitEOFIncomingMessage | answered 200 1 answer | socket close
== a server's request, before the answer: freeze a Proxy that traps isExtensible, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed frozen 28 keys, 28 found, 0 writable, 0 configurable
as that closed sealed frozen 28 keys, 28 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in _dump | request error TypeError in _destroy | request close  | response close  | nobody caught TypeError in emitEOFIncomingMessage | answered 200 1 answer | socket close
== a server's request, before the answer: freeze a Proxy that traps ownKeys, then used itself
traps while closing: 1 of them for a key that is not listed: 0
itself closed sealed frozen 28 keys, 28 found, 0 writable, 0 configurable
as that closed sealed frozen 28 keys, 28 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in _dump | request error TypeError in _destroy | request close  | response close  | nobody caught TypeError in emitEOFIncomingMessage | answered 200 1 answer | socket close
== a server's request, before the answer: freeze a Proxy that traps preventExtensions, then used itself
traps while closing: 1 of them for a key that is not listed: 0
itself closed sealed frozen 28 keys, 28 found, 0 writable, 0 configurable
as that closed sealed frozen 28 keys, 28 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in _dump | request error TypeError in _destroy | request close  | response close  | nobody caught TypeError in emitEOFIncomingMessage | answered 200 1 answer | socket close
== a server's request, before the answer: freeze a Proxy that traps set, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed frozen 28 keys, 28 found, 0 writable, 0 configurable
as that closed sealed frozen 28 keys, 28 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in _dump | request error TypeError in _destroy | request close  | response close  | nobody caught TypeError in emitEOFIncomingMessage | answered 200 1 answer | socket close
== a server's request, before the answer: seal itself, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 28 keys, 28 found, 28 writable, 0 configurable
as that closed sealed 28 keys, 28 found, 28 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- response finish  | response close  | request end  | nobody caught TypeError in endReadableNT | answered 200 1 answer | socket close
== a server's request, before the answer: seal a Proxy, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 28 keys, 28 found, 28 writable, 0 configurable
as that closed sealed 28 keys, 28 found, 28 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- response finish  | response close  | request end  | nobody caught TypeError in endReadableNT | answered 200 1 answer | socket close
== a server's request, before the answer: seal a Proxy, then used as that
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 28 keys, 28 found, 28 writable, 0 configurable
as that closed sealed 28 keys, 28 found, 28 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- response finish  | response close  | request end  | nobody caught TypeError in endReadableNT | answered 200 1 answer | socket close
== a server's request, before the answer: seal a Proxy of a Proxy, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 28 keys, 28 found, 28 writable, 0 configurable
as that closed sealed 28 keys, 28 found, 28 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- response finish  | response close  | request end  | nobody caught TypeError in endReadableNT | answered 200 1 answer | socket close
== a server's request, before the answer: seal a Proxy with every trap, then used itself
traps while closing: 30 of them for a key that is not listed: 0
itself closed sealed 28 keys, 28 found, 28 writable, 0 configurable
as that closed sealed 28 keys, 28 found, 28 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- response finish  | response close  | request end  | nobody caught TypeError in endReadableNT | answered 200 1 answer | socket close
== a server's request, before the answer: seal a Proxy with every trap, then used as that
traps while closing: 30 of them for a key that is not listed: 0
itself closed sealed 28 keys, 28 found, 28 writable, 0 configurable
as that closed sealed 28 keys, 28 found, 28 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- response finish  | response close  | request end  | nobody caught TypeError in endReadableNT | answered 200 1 answer | socket close
== a server's request, before the answer: seal a Proxy with every trap of a Proxy with every trap, then used itself
traps while closing: 147 of them for a key that is not listed: 0
itself closed sealed 28 keys, 28 found, 28 writable, 0 configurable
as that closed sealed 28 keys, 28 found, 28 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- response finish  | response close  | request end  | nobody caught TypeError in endReadableNT | answered 200 1 answer | socket close
== a server's request, before the answer: seal a revoked Proxy, then used itself
closing threw TypeError
traps while closing: 0 of them for a key that is not listed: 0
itself open 28 keys, 28 found, 28 writable, 28 configurable
asking threw TypeError
changing threw TypeError
-- response finish  | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's request, before the answer: seal a Proxy of a revoked Proxy, then used itself
closing threw TypeError
traps while closing: 0 of them for a key that is not listed: 0
itself open 28 keys, 28 found, 28 writable, 28 configurable
asking threw TypeError
changing threw TypeError
-- response finish  | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's request, before the answer: seal a Proxy that traps defineProperty, then used itself
traps while closing: 28 of them for a key that is not listed: 0
itself closed sealed 28 keys, 28 found, 28 writable, 0 configurable
as that closed sealed 28 keys, 28 found, 28 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- response finish  | response close  | request end  | nobody caught TypeError in endReadableNT | answered 200 1 answer | socket close
== a server's request, before the answer: seal a Proxy that traps deleteProperty, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 28 keys, 28 found, 28 writable, 0 configurable
as that closed sealed 28 keys, 28 found, 28 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- response finish  | response close  | request end  | nobody caught TypeError in endReadableNT | answered 200 1 answer | socket close
== a server's request, before the answer: seal a Proxy that traps get, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 28 keys, 28 found, 28 writable, 0 configurable
as that closed sealed 28 keys, 28 found, 28 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- response finish  | response close  | request end  | nobody caught TypeError in endReadableNT | answered 200 1 answer | socket close
== a server's request, before the answer: seal a Proxy that traps getOwnPropertyDescriptor, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 28 keys, 28 found, 28 writable, 0 configurable
as that closed sealed 28 keys, 28 found, 28 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- response finish  | response close  | request end  | nobody caught TypeError in endReadableNT | answered 200 1 answer | socket close
== a server's request, before the answer: seal a Proxy that traps getPrototypeOf, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 28 keys, 28 found, 28 writable, 0 configurable
as that closed sealed 28 keys, 28 found, 28 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- response finish  | response close  | request end  | nobody caught TypeError in endReadableNT | answered 200 1 answer | socket close
== a server's request, before the answer: seal a Proxy that traps has, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 28 keys, 28 found, 28 writable, 0 configurable
as that closed sealed 28 keys, 28 found, 28 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- response finish  | response close  | request end  | nobody caught TypeError in endReadableNT | answered 200 1 answer | socket close
== a server's request, before the answer: seal a Proxy that traps isExtensible, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 28 keys, 28 found, 28 writable, 0 configurable
as that closed sealed 28 keys, 28 found, 28 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- response finish  | response close  | request end  | nobody caught TypeError in endReadableNT | answered 200 1 answer | socket close
== a server's request, before the answer: seal a Proxy that traps ownKeys, then used itself
traps while closing: 1 of them for a key that is not listed: 0
itself closed sealed 28 keys, 28 found, 28 writable, 0 configurable
as that closed sealed 28 keys, 28 found, 28 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- response finish  | response close  | request end  | nobody caught TypeError in endReadableNT | answered 200 1 answer | socket close
== a server's request, before the answer: seal a Proxy that traps preventExtensions, then used itself
traps while closing: 1 of them for a key that is not listed: 0
itself closed sealed 28 keys, 28 found, 28 writable, 0 configurable
as that closed sealed 28 keys, 28 found, 28 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- response finish  | response close  | request end  | nobody caught TypeError in endReadableNT | answered 200 1 answer | socket close
== a server's request, before the answer: seal a Proxy that traps set, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 28 keys, 28 found, 28 writable, 0 configurable
as that closed sealed 28 keys, 28 found, 28 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- response finish  | response close  | request end  | nobody caught TypeError in endReadableNT | answered 200 1 answer | socket close
== a server's request, before the answer: preventExtensions itself, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 28 keys, 28 found, 28 writable, 28 configurable
as that closed 28 keys, 28 found, 28 writable, 28 configurable
defined anew true added false removed true absent removed true absent found false
-- response finish  | response close  | request end  | nobody caught TypeError in endReadableNT | answered 200 1 answer | socket close
== a server's request, before the answer: preventExtensions a Proxy, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 28 keys, 28 found, 28 writable, 28 configurable
as that closed 28 keys, 28 found, 28 writable, 28 configurable
defined anew true added false removed true absent removed true absent found false
-- response finish  | response close  | request end  | nobody caught TypeError in endReadableNT | answered 200 1 answer | socket close
== a server's request, before the answer: preventExtensions a Proxy, then used as that
traps while closing: 0 of them for a key that is not listed: 0
itself closed 28 keys, 28 found, 28 writable, 28 configurable
as that closed 28 keys, 28 found, 28 writable, 28 configurable
defined anew true added false removed true absent removed true absent found false
-- response finish  | response close  | request end  | nobody caught TypeError in endReadableNT | answered 200 1 answer | socket close
== a server's request, before the answer: preventExtensions a Proxy of a Proxy, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 28 keys, 28 found, 28 writable, 28 configurable
as that closed 28 keys, 28 found, 28 writable, 28 configurable
defined anew true added false removed true absent removed true absent found false
-- response finish  | response close  | request end  | nobody caught TypeError in endReadableNT | answered 200 1 answer | socket close
== a server's request, before the answer: preventExtensions a Proxy with every trap, then used itself
traps while closing: 1 of them for a key that is not listed: 0
itself closed 28 keys, 28 found, 28 writable, 28 configurable
as that closed 28 keys, 28 found, 28 writable, 28 configurable
defined anew true added false removed true absent removed true absent found false
-- response finish  | response close  | request end  | nobody caught TypeError in endReadableNT | answered 200 1 answer | socket close
== a server's request, before the answer: preventExtensions a Proxy with every trap, then used as that
traps while closing: 1 of them for a key that is not listed: 0
itself closed 28 keys, 28 found, 28 writable, 28 configurable
as that closed 28 keys, 28 found, 28 writable, 28 configurable
defined anew true added false removed true absent removed true absent found false
-- response finish  | response close  | request end  | nobody caught TypeError in endReadableNT | answered 200 1 answer | socket close
== a server's request, before the answer: preventExtensions a Proxy with every trap of a Proxy with every trap, then used itself
traps while closing: 3 of them for a key that is not listed: 0
itself closed 28 keys, 28 found, 28 writable, 28 configurable
as that closed 28 keys, 28 found, 28 writable, 28 configurable
defined anew true added false removed true absent removed true absent found false
-- response finish  | response close  | request end  | nobody caught TypeError in endReadableNT | answered 200 1 answer | socket close
== a server's request, before the answer: preventExtensions a revoked Proxy, then used itself
closing threw TypeError
traps while closing: 0 of them for a key that is not listed: 0
itself open 28 keys, 28 found, 28 writable, 28 configurable
asking threw TypeError
changing threw TypeError
-- response finish  | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's request, before the answer: preventExtensions a Proxy of a revoked Proxy, then used itself
closing threw TypeError
traps while closing: 0 of them for a key that is not listed: 0
itself open 28 keys, 28 found, 28 writable, 28 configurable
asking threw TypeError
changing threw TypeError
-- response finish  | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's request, before the answer: preventExtensions a Proxy that traps defineProperty, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 28 keys, 28 found, 28 writable, 28 configurable
as that closed 28 keys, 28 found, 28 writable, 28 configurable
defined anew true added false removed true absent removed true absent found false
-- response finish  | response close  | request end  | nobody caught TypeError in endReadableNT | answered 200 1 answer | socket close
== a server's request, before the answer: preventExtensions a Proxy that traps deleteProperty, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 28 keys, 28 found, 28 writable, 28 configurable
as that closed 28 keys, 28 found, 28 writable, 28 configurable
defined anew true added false removed true absent removed true absent found false
-- response finish  | response close  | request end  | nobody caught TypeError in endReadableNT | answered 200 1 answer | socket close
== a server's request, before the answer: preventExtensions a Proxy that traps get, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 28 keys, 28 found, 28 writable, 28 configurable
as that closed 28 keys, 28 found, 28 writable, 28 configurable
defined anew true added false removed true absent removed true absent found false
-- response finish  | response close  | request end  | nobody caught TypeError in endReadableNT | answered 200 1 answer | socket close
== a server's request, before the answer: preventExtensions a Proxy that traps getOwnPropertyDescriptor, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 28 keys, 28 found, 28 writable, 28 configurable
as that closed 28 keys, 28 found, 28 writable, 28 configurable
defined anew true added false removed true absent removed true absent found false
-- response finish  | response close  | request end  | nobody caught TypeError in endReadableNT | answered 200 1 answer | socket close
== a server's request, before the answer: preventExtensions a Proxy that traps getPrototypeOf, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 28 keys, 28 found, 28 writable, 28 configurable
as that closed 28 keys, 28 found, 28 writable, 28 configurable
defined anew true added false removed true absent removed true absent found false
-- response finish  | response close  | request end  | nobody caught TypeError in endReadableNT | answered 200 1 answer | socket close
== a server's request, before the answer: preventExtensions a Proxy that traps has, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 28 keys, 28 found, 28 writable, 28 configurable
as that closed 28 keys, 28 found, 28 writable, 28 configurable
defined anew true added false removed true absent removed true absent found false
-- response finish  | response close  | request end  | nobody caught TypeError in endReadableNT | answered 200 1 answer | socket close
== a server's request, before the answer: preventExtensions a Proxy that traps isExtensible, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 28 keys, 28 found, 28 writable, 28 configurable
as that closed 28 keys, 28 found, 28 writable, 28 configurable
defined anew true added false removed true absent removed true absent found false
-- response finish  | response close  | request end  | nobody caught TypeError in endReadableNT | answered 200 1 answer | socket close
== a server's request, before the answer: preventExtensions a Proxy that traps ownKeys, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 28 keys, 28 found, 28 writable, 28 configurable
as that closed 28 keys, 28 found, 28 writable, 28 configurable
defined anew true added false removed true absent removed true absent found false
-- response finish  | response close  | request end  | nobody caught TypeError in endReadableNT | answered 200 1 answer | socket close
== a server's request, before the answer: preventExtensions a Proxy that traps preventExtensions, then used itself
traps while closing: 1 of them for a key that is not listed: 0
itself closed 28 keys, 28 found, 28 writable, 28 configurable
as that closed 28 keys, 28 found, 28 writable, 28 configurable
defined anew true added false removed true absent removed true absent found false
-- response finish  | response close  | request end  | nobody caught TypeError in endReadableNT | answered 200 1 answer | socket close
== a server's request, before the answer: preventExtensions a Proxy that traps set, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 28 keys, 28 found, 28 writable, 28 configurable
as that closed 28 keys, 28 found, 28 writable, 28 configurable
defined anew true added false removed true absent removed true absent found false
-- response finish  | response close  | request end  | nobody caught TypeError in endReadableNT | answered 200 1 answer | socket close
== a server's request, after the answer: nothing itself, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself open 28 keys, 28 found, 28 writable, 28 configurable
as that open 28 keys, 28 found, 28 writable, 28 configurable
defined anew true added true removed true absent removed true absent found false
-- response finish  | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's request, after the answer: freeze itself, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed frozen 28 keys, 28 found, 0 writable, 0 configurable
as that closed sealed frozen 28 keys, 28 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in _dump | request error TypeError in _destroy | request close  | response close  | nobody caught TypeError in emitEOFIncomingMessage | answered 200 1 answer | socket close
== a server's request, after the answer: freeze a Proxy, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed frozen 28 keys, 28 found, 0 writable, 0 configurable
as that closed sealed frozen 28 keys, 28 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in _dump | request error TypeError in _destroy | request close  | response close  | nobody caught TypeError in emitEOFIncomingMessage | answered 200 1 answer | socket close
== a server's request, after the answer: freeze a Proxy, then used as that
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed frozen 28 keys, 28 found, 0 writable, 0 configurable
as that closed sealed frozen 28 keys, 28 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in _dump | request error TypeError in _destroy | request close  | response close  | nobody caught TypeError in emitEOFIncomingMessage | answered 200 1 answer | socket close
== a server's request, after the answer: freeze a Proxy of a Proxy, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed frozen 28 keys, 28 found, 0 writable, 0 configurable
as that closed sealed frozen 28 keys, 28 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in _dump | request error TypeError in _destroy | request close  | response close  | nobody caught TypeError in emitEOFIncomingMessage | answered 200 1 answer | socket close
== a server's request, after the answer: freeze a Proxy with every trap, then used itself
traps while closing: 58 of them for a key that is not listed: 0
itself closed sealed frozen 28 keys, 28 found, 0 writable, 0 configurable
as that closed sealed frozen 28 keys, 28 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in _dump | request error TypeError in _destroy | request close  | response close  | nobody caught TypeError in emitEOFIncomingMessage | answered 200 1 answer | socket close
== a server's request, after the answer: freeze a Proxy with every trap, then used as that
traps while closing: 58 of them for a key that is not listed: 0
itself closed sealed frozen 28 keys, 28 found, 0 writable, 0 configurable
as that closed sealed frozen 28 keys, 28 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in _dump | request error TypeError in _destroy | request close  | response close  | nobody caught TypeError in emitEOFIncomingMessage | answered 200 1 answer | socket close
== a server's request, after the answer: freeze a Proxy with every trap of a Proxy with every trap, then used itself
traps while closing: 259 of them for a key that is not listed: 0
itself closed sealed frozen 28 keys, 28 found, 0 writable, 0 configurable
as that closed sealed frozen 28 keys, 28 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in _dump | request error TypeError in _destroy | request close  | response close  | nobody caught TypeError in emitEOFIncomingMessage | answered 200 1 answer | socket close
== a server's request, after the answer: freeze a revoked Proxy, then used itself
closing threw TypeError
traps while closing: 0 of them for a key that is not listed: 0
itself open 28 keys, 28 found, 28 writable, 28 configurable
asking threw TypeError
changing threw TypeError
-- response finish  | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's request, after the answer: freeze a Proxy of a revoked Proxy, then used itself
closing threw TypeError
traps while closing: 0 of them for a key that is not listed: 0
itself open 28 keys, 28 found, 28 writable, 28 configurable
asking threw TypeError
changing threw TypeError
-- response finish  | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's request, after the answer: freeze a Proxy that traps defineProperty, then used itself
traps while closing: 28 of them for a key that is not listed: 0
itself closed sealed frozen 28 keys, 28 found, 0 writable, 0 configurable
as that closed sealed frozen 28 keys, 28 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in _dump | request error TypeError in _destroy | request close  | response close  | nobody caught TypeError in emitEOFIncomingMessage | answered 200 1 answer | socket close
== a server's request, after the answer: freeze a Proxy that traps deleteProperty, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed frozen 28 keys, 28 found, 0 writable, 0 configurable
as that closed sealed frozen 28 keys, 28 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in _dump | request error TypeError in _destroy | request close  | response close  | nobody caught TypeError in emitEOFIncomingMessage | answered 200 1 answer | socket close
== a server's request, after the answer: freeze a Proxy that traps get, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed frozen 28 keys, 28 found, 0 writable, 0 configurable
as that closed sealed frozen 28 keys, 28 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in _dump | request error TypeError in _destroy | request close  | response close  | nobody caught TypeError in emitEOFIncomingMessage | answered 200 1 answer | socket close
== a server's request, after the answer: freeze a Proxy that traps getOwnPropertyDescriptor, then used itself
traps while closing: 28 of them for a key that is not listed: 0
itself closed sealed frozen 28 keys, 28 found, 0 writable, 0 configurable
as that closed sealed frozen 28 keys, 28 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in _dump | request error TypeError in _destroy | request close  | response close  | nobody caught TypeError in emitEOFIncomingMessage | answered 200 1 answer | socket close
== a server's request, after the answer: freeze a Proxy that traps getPrototypeOf, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed frozen 28 keys, 28 found, 0 writable, 0 configurable
as that closed sealed frozen 28 keys, 28 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in _dump | request error TypeError in _destroy | request close  | response close  | nobody caught TypeError in emitEOFIncomingMessage | answered 200 1 answer | socket close
== a server's request, after the answer: freeze a Proxy that traps has, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed frozen 28 keys, 28 found, 0 writable, 0 configurable
as that closed sealed frozen 28 keys, 28 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in _dump | request error TypeError in _destroy | request close  | response close  | nobody caught TypeError in emitEOFIncomingMessage | answered 200 1 answer | socket close
== a server's request, after the answer: freeze a Proxy that traps isExtensible, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed frozen 28 keys, 28 found, 0 writable, 0 configurable
as that closed sealed frozen 28 keys, 28 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in _dump | request error TypeError in _destroy | request close  | response close  | nobody caught TypeError in emitEOFIncomingMessage | answered 200 1 answer | socket close
== a server's request, after the answer: freeze a Proxy that traps ownKeys, then used itself
traps while closing: 1 of them for a key that is not listed: 0
itself closed sealed frozen 28 keys, 28 found, 0 writable, 0 configurable
as that closed sealed frozen 28 keys, 28 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in _dump | request error TypeError in _destroy | request close  | response close  | nobody caught TypeError in emitEOFIncomingMessage | answered 200 1 answer | socket close
== a server's request, after the answer: freeze a Proxy that traps preventExtensions, then used itself
traps while closing: 1 of them for a key that is not listed: 0
itself closed sealed frozen 28 keys, 28 found, 0 writable, 0 configurable
as that closed sealed frozen 28 keys, 28 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in _dump | request error TypeError in _destroy | request close  | response close  | nobody caught TypeError in emitEOFIncomingMessage | answered 200 1 answer | socket close
== a server's request, after the answer: freeze a Proxy that traps set, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed frozen 28 keys, 28 found, 0 writable, 0 configurable
as that closed sealed frozen 28 keys, 28 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in _dump | request error TypeError in _destroy | request close  | response close  | nobody caught TypeError in emitEOFIncomingMessage | answered 200 1 answer | socket close
== a server's request, after the answer: seal itself, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 28 keys, 28 found, 28 writable, 0 configurable
as that closed sealed 28 keys, 28 found, 28 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- response finish  | response close  | request end  | nobody caught TypeError in endReadableNT | answered 200 1 answer | socket close
== a server's request, after the answer: seal a Proxy, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 28 keys, 28 found, 28 writable, 0 configurable
as that closed sealed 28 keys, 28 found, 28 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- response finish  | response close  | request end  | nobody caught TypeError in endReadableNT | answered 200 1 answer | socket close
== a server's request, after the answer: seal a Proxy, then used as that
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 28 keys, 28 found, 28 writable, 0 configurable
as that closed sealed 28 keys, 28 found, 28 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- response finish  | response close  | request end  | nobody caught TypeError in endReadableNT | answered 200 1 answer | socket close
== a server's request, after the answer: seal a Proxy of a Proxy, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 28 keys, 28 found, 28 writable, 0 configurable
as that closed sealed 28 keys, 28 found, 28 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- response finish  | response close  | request end  | nobody caught TypeError in endReadableNT | answered 200 1 answer | socket close
== a server's request, after the answer: seal a Proxy with every trap, then used itself
traps while closing: 30 of them for a key that is not listed: 0
itself closed sealed 28 keys, 28 found, 28 writable, 0 configurable
as that closed sealed 28 keys, 28 found, 28 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- response finish  | response close  | request end  | nobody caught TypeError in endReadableNT | answered 200 1 answer | socket close
== a server's request, after the answer: seal a Proxy with every trap, then used as that
traps while closing: 30 of them for a key that is not listed: 0
itself closed sealed 28 keys, 28 found, 28 writable, 0 configurable
as that closed sealed 28 keys, 28 found, 28 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- response finish  | response close  | request end  | nobody caught TypeError in endReadableNT | answered 200 1 answer | socket close
== a server's request, after the answer: seal a Proxy with every trap of a Proxy with every trap, then used itself
traps while closing: 147 of them for a key that is not listed: 0
itself closed sealed 28 keys, 28 found, 28 writable, 0 configurable
as that closed sealed 28 keys, 28 found, 28 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- response finish  | response close  | request end  | nobody caught TypeError in endReadableNT | answered 200 1 answer | socket close
== a server's request, after the answer: seal a revoked Proxy, then used itself
closing threw TypeError
traps while closing: 0 of them for a key that is not listed: 0
itself open 28 keys, 28 found, 28 writable, 28 configurable
asking threw TypeError
changing threw TypeError
-- response finish  | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's request, after the answer: seal a Proxy of a revoked Proxy, then used itself
closing threw TypeError
traps while closing: 0 of them for a key that is not listed: 0
itself open 28 keys, 28 found, 28 writable, 28 configurable
asking threw TypeError
changing threw TypeError
-- response finish  | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's request, after the answer: seal a Proxy that traps defineProperty, then used itself
traps while closing: 28 of them for a key that is not listed: 0
itself closed sealed 28 keys, 28 found, 28 writable, 0 configurable
as that closed sealed 28 keys, 28 found, 28 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- response finish  | response close  | request end  | nobody caught TypeError in endReadableNT | answered 200 1 answer | socket close
== a server's request, after the answer: seal a Proxy that traps deleteProperty, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 28 keys, 28 found, 28 writable, 0 configurable
as that closed sealed 28 keys, 28 found, 28 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- response finish  | response close  | request end  | nobody caught TypeError in endReadableNT | answered 200 1 answer | socket close
== a server's request, after the answer: seal a Proxy that traps get, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 28 keys, 28 found, 28 writable, 0 configurable
as that closed sealed 28 keys, 28 found, 28 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- response finish  | response close  | request end  | nobody caught TypeError in endReadableNT | answered 200 1 answer | socket close
== a server's request, after the answer: seal a Proxy that traps getOwnPropertyDescriptor, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 28 keys, 28 found, 28 writable, 0 configurable
as that closed sealed 28 keys, 28 found, 28 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- response finish  | response close  | request end  | nobody caught TypeError in endReadableNT | answered 200 1 answer | socket close
== a server's request, after the answer: seal a Proxy that traps getPrototypeOf, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 28 keys, 28 found, 28 writable, 0 configurable
as that closed sealed 28 keys, 28 found, 28 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- response finish  | response close  | request end  | nobody caught TypeError in endReadableNT | answered 200 1 answer | socket close
== a server's request, after the answer: seal a Proxy that traps has, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 28 keys, 28 found, 28 writable, 0 configurable
as that closed sealed 28 keys, 28 found, 28 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- response finish  | response close  | request end  | nobody caught TypeError in endReadableNT | answered 200 1 answer | socket close
== a server's request, after the answer: seal a Proxy that traps isExtensible, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 28 keys, 28 found, 28 writable, 0 configurable
as that closed sealed 28 keys, 28 found, 28 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- response finish  | response close  | request end  | nobody caught TypeError in endReadableNT | answered 200 1 answer | socket close
== a server's request, after the answer: seal a Proxy that traps ownKeys, then used itself
traps while closing: 1 of them for a key that is not listed: 0
itself closed sealed 28 keys, 28 found, 28 writable, 0 configurable
as that closed sealed 28 keys, 28 found, 28 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- response finish  | response close  | request end  | nobody caught TypeError in endReadableNT | answered 200 1 answer | socket close
== a server's request, after the answer: seal a Proxy that traps preventExtensions, then used itself
traps while closing: 1 of them for a key that is not listed: 0
itself closed sealed 28 keys, 28 found, 28 writable, 0 configurable
as that closed sealed 28 keys, 28 found, 28 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- response finish  | response close  | request end  | nobody caught TypeError in endReadableNT | answered 200 1 answer | socket close
== a server's request, after the answer: seal a Proxy that traps set, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 28 keys, 28 found, 28 writable, 0 configurable
as that closed sealed 28 keys, 28 found, 28 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- response finish  | response close  | request end  | nobody caught TypeError in endReadableNT | answered 200 1 answer | socket close
== a server's request, after the answer: preventExtensions itself, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 28 keys, 28 found, 28 writable, 28 configurable
as that closed 28 keys, 28 found, 28 writable, 28 configurable
defined anew true added false removed true absent removed true absent found false
-- response finish  | response close  | request end  | nobody caught TypeError in endReadableNT | answered 200 1 answer | socket close
== a server's request, after the answer: preventExtensions a Proxy, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 28 keys, 28 found, 28 writable, 28 configurable
as that closed 28 keys, 28 found, 28 writable, 28 configurable
defined anew true added false removed true absent removed true absent found false
-- response finish  | response close  | request end  | nobody caught TypeError in endReadableNT | answered 200 1 answer | socket close
== a server's request, after the answer: preventExtensions a Proxy, then used as that
traps while closing: 0 of them for a key that is not listed: 0
itself closed 28 keys, 28 found, 28 writable, 28 configurable
as that closed 28 keys, 28 found, 28 writable, 28 configurable
defined anew true added false removed true absent removed true absent found false
-- response finish  | response close  | request end  | nobody caught TypeError in endReadableNT | answered 200 1 answer | socket close
== a server's request, after the answer: preventExtensions a Proxy of a Proxy, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 28 keys, 28 found, 28 writable, 28 configurable
as that closed 28 keys, 28 found, 28 writable, 28 configurable
defined anew true added false removed true absent removed true absent found false
-- response finish  | response close  | request end  | nobody caught TypeError in endReadableNT | answered 200 1 answer | socket close
== a server's request, after the answer: preventExtensions a Proxy with every trap, then used itself
traps while closing: 1 of them for a key that is not listed: 0
itself closed 28 keys, 28 found, 28 writable, 28 configurable
as that closed 28 keys, 28 found, 28 writable, 28 configurable
defined anew true added false removed true absent removed true absent found false
-- response finish  | response close  | request end  | nobody caught TypeError in endReadableNT | answered 200 1 answer | socket close
== a server's request, after the answer: preventExtensions a Proxy with every trap, then used as that
traps while closing: 1 of them for a key that is not listed: 0
itself closed 28 keys, 28 found, 28 writable, 28 configurable
as that closed 28 keys, 28 found, 28 writable, 28 configurable
defined anew true added false removed true absent removed true absent found false
-- response finish  | response close  | request end  | nobody caught TypeError in endReadableNT | answered 200 1 answer | socket close
== a server's request, after the answer: preventExtensions a Proxy with every trap of a Proxy with every trap, then used itself
traps while closing: 3 of them for a key that is not listed: 0
itself closed 28 keys, 28 found, 28 writable, 28 configurable
as that closed 28 keys, 28 found, 28 writable, 28 configurable
defined anew true added false removed true absent removed true absent found false
-- response finish  | response close  | request end  | nobody caught TypeError in endReadableNT | answered 200 1 answer | socket close
== a server's request, after the answer: preventExtensions a revoked Proxy, then used itself
closing threw TypeError
traps while closing: 0 of them for a key that is not listed: 0
itself open 28 keys, 28 found, 28 writable, 28 configurable
asking threw TypeError
changing threw TypeError
-- response finish  | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's request, after the answer: preventExtensions a Proxy of a revoked Proxy, then used itself
closing threw TypeError
traps while closing: 0 of them for a key that is not listed: 0
itself open 28 keys, 28 found, 28 writable, 28 configurable
asking threw TypeError
changing threw TypeError
-- response finish  | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's request, after the answer: preventExtensions a Proxy that traps defineProperty, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 28 keys, 28 found, 28 writable, 28 configurable
as that closed 28 keys, 28 found, 28 writable, 28 configurable
defined anew true added false removed true absent removed true absent found false
-- response finish  | response close  | request end  | nobody caught TypeError in endReadableNT | answered 200 1 answer | socket close
== a server's request, after the answer: preventExtensions a Proxy that traps deleteProperty, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 28 keys, 28 found, 28 writable, 28 configurable
as that closed 28 keys, 28 found, 28 writable, 28 configurable
defined anew true added false removed true absent removed true absent found false
-- response finish  | response close  | request end  | nobody caught TypeError in endReadableNT | answered 200 1 answer | socket close
== a server's request, after the answer: preventExtensions a Proxy that traps get, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 28 keys, 28 found, 28 writable, 28 configurable
as that closed 28 keys, 28 found, 28 writable, 28 configurable
defined anew true added false removed true absent removed true absent found false
-- response finish  | response close  | request end  | nobody caught TypeError in endReadableNT | answered 200 1 answer | socket close
== a server's request, after the answer: preventExtensions a Proxy that traps getOwnPropertyDescriptor, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 28 keys, 28 found, 28 writable, 28 configurable
as that closed 28 keys, 28 found, 28 writable, 28 configurable
defined anew true added false removed true absent removed true absent found false
-- response finish  | response close  | request end  | nobody caught TypeError in endReadableNT | answered 200 1 answer | socket close
== a server's request, after the answer: preventExtensions a Proxy that traps getPrototypeOf, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 28 keys, 28 found, 28 writable, 28 configurable
as that closed 28 keys, 28 found, 28 writable, 28 configurable
defined anew true added false removed true absent removed true absent found false
-- response finish  | response close  | request end  | nobody caught TypeError in endReadableNT | answered 200 1 answer | socket close
== a server's request, after the answer: preventExtensions a Proxy that traps has, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 28 keys, 28 found, 28 writable, 28 configurable
as that closed 28 keys, 28 found, 28 writable, 28 configurable
defined anew true added false removed true absent removed true absent found false
-- response finish  | response close  | request end  | nobody caught TypeError in endReadableNT | answered 200 1 answer | socket close
== a server's request, after the answer: preventExtensions a Proxy that traps isExtensible, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 28 keys, 28 found, 28 writable, 28 configurable
as that closed 28 keys, 28 found, 28 writable, 28 configurable
defined anew true added false removed true absent removed true absent found false
-- response finish  | response close  | request end  | nobody caught TypeError in endReadableNT | answered 200 1 answer | socket close
== a server's request, after the answer: preventExtensions a Proxy that traps ownKeys, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 28 keys, 28 found, 28 writable, 28 configurable
as that closed 28 keys, 28 found, 28 writable, 28 configurable
defined anew true added false removed true absent removed true absent found false
-- response finish  | response close  | request end  | nobody caught TypeError in endReadableNT | answered 200 1 answer | socket close
== a server's request, after the answer: preventExtensions a Proxy that traps preventExtensions, then used itself
traps while closing: 1 of them for a key that is not listed: 0
itself closed 28 keys, 28 found, 28 writable, 28 configurable
as that closed 28 keys, 28 found, 28 writable, 28 configurable
defined anew true added false removed true absent removed true absent found false
-- response finish  | response close  | request end  | nobody caught TypeError in endReadableNT | answered 200 1 answer | socket close
== a server's request, after the answer: preventExtensions a Proxy that traps set, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 28 keys, 28 found, 28 writable, 28 configurable
as that closed 28 keys, 28 found, 28 writable, 28 configurable
defined anew true added false removed true absent removed true absent found false
-- response finish  | response close  | request end  | nobody caught TypeError in endReadableNT | answered 200 1 answer | socket close
== a server's response, before the answer: nothing itself, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself open 48 keys, 48 found, 48 writable, 48 configurable
as that open 48 keys, 48 found, 48 writable, 48 configurable
defined anew true added true removed true absent removed true absent found false
-- response finish  | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's response, before the answer: seal itself, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 48 keys, 48 found, 48 writable, 0 configurable
as that closed sealed 48 keys, 48 found, 48 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in onNodeHTTPRequest | nobody caught TypeError in markResponseEndedNT | response finish  | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's response, before the answer: seal a Proxy, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 48 keys, 48 found, 48 writable, 0 configurable
as that closed sealed 48 keys, 48 found, 48 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in onNodeHTTPRequest | nobody caught TypeError in markResponseEndedNT | response finish  | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's response, before the answer: seal a Proxy, then used as that
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 48 keys, 48 found, 48 writable, 0 configurable
as that closed sealed 48 keys, 48 found, 48 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in onNodeHTTPRequest | nobody caught TypeError in markResponseEndedNT | response finish  | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's response, before the answer: seal a Proxy of a Proxy, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 48 keys, 48 found, 48 writable, 0 configurable
as that closed sealed 48 keys, 48 found, 48 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in onNodeHTTPRequest | nobody caught TypeError in markResponseEndedNT | response finish  | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's response, before the answer: seal a Proxy with every trap, then used itself
traps while closing: 50 of them for a key that is not listed: 0
itself closed sealed 48 keys, 48 found, 48 writable, 0 configurable
as that closed sealed 48 keys, 48 found, 48 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in onNodeHTTPRequest | nobody caught TypeError in markResponseEndedNT | response finish  | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's response, before the answer: seal a Proxy with every trap, then used as that
traps while closing: 50 of them for a key that is not listed: 0
itself closed sealed 48 keys, 48 found, 48 writable, 0 configurable
as that closed sealed 48 keys, 48 found, 48 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in onNodeHTTPRequest | nobody caught TypeError in markResponseEndedNT | response finish  | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's response, before the answer: seal a Proxy with every trap of a Proxy with every trap, then used itself
traps while closing: 247 of them for a key that is not listed: 0
itself closed sealed 48 keys, 48 found, 48 writable, 0 configurable
as that closed sealed 48 keys, 48 found, 48 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in onNodeHTTPRequest | nobody caught TypeError in markResponseEndedNT | response finish  | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's response, before the answer: seal a revoked Proxy, then used itself
closing threw TypeError
traps while closing: 0 of them for a key that is not listed: 0
itself open 48 keys, 48 found, 48 writable, 48 configurable
asking threw TypeError
changing threw TypeError
-- response finish  | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's response, before the answer: seal a Proxy of a revoked Proxy, then used itself
closing threw TypeError
traps while closing: 0 of them for a key that is not listed: 0
itself open 48 keys, 48 found, 48 writable, 48 configurable
asking threw TypeError
changing threw TypeError
-- response finish  | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's response, before the answer: seal a Proxy that traps defineProperty, then used itself
traps while closing: 48 of them for a key that is not listed: 0
itself closed sealed 48 keys, 48 found, 48 writable, 0 configurable
as that closed sealed 48 keys, 48 found, 48 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in onNodeHTTPRequest | nobody caught TypeError in markResponseEndedNT | response finish  | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's response, before the answer: seal a Proxy that traps deleteProperty, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 48 keys, 48 found, 48 writable, 0 configurable
as that closed sealed 48 keys, 48 found, 48 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in onNodeHTTPRequest | nobody caught TypeError in markResponseEndedNT | response finish  | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's response, before the answer: seal a Proxy that traps get, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 48 keys, 48 found, 48 writable, 0 configurable
as that closed sealed 48 keys, 48 found, 48 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in onNodeHTTPRequest | nobody caught TypeError in markResponseEndedNT | response finish  | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's response, before the answer: seal a Proxy that traps getOwnPropertyDescriptor, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 48 keys, 48 found, 48 writable, 0 configurable
as that closed sealed 48 keys, 48 found, 48 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in onNodeHTTPRequest | nobody caught TypeError in markResponseEndedNT | response finish  | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's response, before the answer: seal a Proxy that traps getPrototypeOf, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 48 keys, 48 found, 48 writable, 0 configurable
as that closed sealed 48 keys, 48 found, 48 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in onNodeHTTPRequest | nobody caught TypeError in markResponseEndedNT | response finish  | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's response, before the answer: seal a Proxy that traps has, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 48 keys, 48 found, 48 writable, 0 configurable
as that closed sealed 48 keys, 48 found, 48 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in onNodeHTTPRequest | nobody caught TypeError in markResponseEndedNT | response finish  | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's response, before the answer: seal a Proxy that traps isExtensible, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 48 keys, 48 found, 48 writable, 0 configurable
as that closed sealed 48 keys, 48 found, 48 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in onNodeHTTPRequest | nobody caught TypeError in markResponseEndedNT | response finish  | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's response, before the answer: seal a Proxy that traps ownKeys, then used itself
traps while closing: 1 of them for a key that is not listed: 0
itself closed sealed 48 keys, 48 found, 48 writable, 0 configurable
as that closed sealed 48 keys, 48 found, 48 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in onNodeHTTPRequest | nobody caught TypeError in markResponseEndedNT | response finish  | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's response, before the answer: seal a Proxy that traps preventExtensions, then used itself
traps while closing: 1 of them for a key that is not listed: 0
itself closed sealed 48 keys, 48 found, 48 writable, 0 configurable
as that closed sealed 48 keys, 48 found, 48 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in onNodeHTTPRequest | nobody caught TypeError in markResponseEndedNT | response finish  | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's response, before the answer: seal a Proxy that traps set, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 48 keys, 48 found, 48 writable, 0 configurable
as that closed sealed 48 keys, 48 found, 48 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in onNodeHTTPRequest | nobody caught TypeError in markResponseEndedNT | response finish  | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's response, before the answer: preventExtensions itself, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 48 keys, 48 found, 48 writable, 48 configurable
as that closed 48 keys, 48 found, 48 writable, 48 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in onNodeHTTPRequest | nobody caught TypeError in markResponseEndedNT | response finish  | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's response, before the answer: preventExtensions a Proxy, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 48 keys, 48 found, 48 writable, 48 configurable
as that closed 48 keys, 48 found, 48 writable, 48 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in onNodeHTTPRequest | nobody caught TypeError in markResponseEndedNT | response finish  | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's response, before the answer: preventExtensions a Proxy, then used as that
traps while closing: 0 of them for a key that is not listed: 0
itself closed 48 keys, 48 found, 48 writable, 48 configurable
as that closed 48 keys, 48 found, 48 writable, 48 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in onNodeHTTPRequest | nobody caught TypeError in markResponseEndedNT | response finish  | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's response, before the answer: preventExtensions a Proxy of a Proxy, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 48 keys, 48 found, 48 writable, 48 configurable
as that closed 48 keys, 48 found, 48 writable, 48 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in onNodeHTTPRequest | nobody caught TypeError in markResponseEndedNT | response finish  | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's response, before the answer: preventExtensions a Proxy with every trap, then used itself
traps while closing: 1 of them for a key that is not listed: 0
itself closed 48 keys, 48 found, 48 writable, 48 configurable
as that closed 48 keys, 48 found, 48 writable, 48 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in onNodeHTTPRequest | nobody caught TypeError in markResponseEndedNT | response finish  | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's response, before the answer: preventExtensions a Proxy with every trap, then used as that
traps while closing: 1 of them for a key that is not listed: 0
itself closed 48 keys, 48 found, 48 writable, 48 configurable
as that closed 48 keys, 48 found, 48 writable, 48 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in onNodeHTTPRequest | nobody caught TypeError in markResponseEndedNT | response finish  | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's response, before the answer: preventExtensions a Proxy with every trap of a Proxy with every trap, then used itself
traps while closing: 3 of them for a key that is not listed: 0
itself closed 48 keys, 48 found, 48 writable, 48 configurable
as that closed 48 keys, 48 found, 48 writable, 48 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in onNodeHTTPRequest | nobody caught TypeError in markResponseEndedNT | response finish  | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's response, before the answer: preventExtensions a revoked Proxy, then used itself
closing threw TypeError
traps while closing: 0 of them for a key that is not listed: 0
itself open 48 keys, 48 found, 48 writable, 48 configurable
asking threw TypeError
changing threw TypeError
-- response finish  | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's response, before the answer: preventExtensions a Proxy of a revoked Proxy, then used itself
closing threw TypeError
traps while closing: 0 of them for a key that is not listed: 0
itself open 48 keys, 48 found, 48 writable, 48 configurable
asking threw TypeError
changing threw TypeError
-- response finish  | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's response, before the answer: preventExtensions a Proxy that traps defineProperty, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 48 keys, 48 found, 48 writable, 48 configurable
as that closed 48 keys, 48 found, 48 writable, 48 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in onNodeHTTPRequest | nobody caught TypeError in markResponseEndedNT | response finish  | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's response, before the answer: preventExtensions a Proxy that traps deleteProperty, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 48 keys, 48 found, 48 writable, 48 configurable
as that closed 48 keys, 48 found, 48 writable, 48 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in onNodeHTTPRequest | nobody caught TypeError in markResponseEndedNT | response finish  | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's response, before the answer: preventExtensions a Proxy that traps get, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 48 keys, 48 found, 48 writable, 48 configurable
as that closed 48 keys, 48 found, 48 writable, 48 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in onNodeHTTPRequest | nobody caught TypeError in markResponseEndedNT | response finish  | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's response, before the answer: preventExtensions a Proxy that traps getOwnPropertyDescriptor, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 48 keys, 48 found, 48 writable, 48 configurable
as that closed 48 keys, 48 found, 48 writable, 48 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in onNodeHTTPRequest | nobody caught TypeError in markResponseEndedNT | response finish  | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's response, before the answer: preventExtensions a Proxy that traps getPrototypeOf, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 48 keys, 48 found, 48 writable, 48 configurable
as that closed 48 keys, 48 found, 48 writable, 48 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in onNodeHTTPRequest | nobody caught TypeError in markResponseEndedNT | response finish  | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's response, before the answer: preventExtensions a Proxy that traps has, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 48 keys, 48 found, 48 writable, 48 configurable
as that closed 48 keys, 48 found, 48 writable, 48 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in onNodeHTTPRequest | nobody caught TypeError in markResponseEndedNT | response finish  | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's response, before the answer: preventExtensions a Proxy that traps isExtensible, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 48 keys, 48 found, 48 writable, 48 configurable
as that closed 48 keys, 48 found, 48 writable, 48 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in onNodeHTTPRequest | nobody caught TypeError in markResponseEndedNT | response finish  | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's response, before the answer: preventExtensions a Proxy that traps ownKeys, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 48 keys, 48 found, 48 writable, 48 configurable
as that closed 48 keys, 48 found, 48 writable, 48 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in onNodeHTTPRequest | nobody caught TypeError in markResponseEndedNT | response finish  | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's response, before the answer: preventExtensions a Proxy that traps preventExtensions, then used itself
traps while closing: 1 of them for a key that is not listed: 0
itself closed 48 keys, 48 found, 48 writable, 48 configurable
as that closed 48 keys, 48 found, 48 writable, 48 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in onNodeHTTPRequest | nobody caught TypeError in markResponseEndedNT | response finish  | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's response, before the answer: preventExtensions a Proxy that traps set, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 48 keys, 48 found, 48 writable, 48 configurable
as that closed 48 keys, 48 found, 48 writable, 48 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in onNodeHTTPRequest | nobody caught TypeError in markResponseEndedNT | response finish  | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's response, after the answer: nothing itself, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself open 48 keys, 48 found, 48 writable, 48 configurable
as that open 48 keys, 48 found, 48 writable, 48 configurable
defined anew true added true removed true absent removed true absent found false
-- response finish  | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's response, after the answer: freeze itself, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed frozen 48 keys, 48 found, 0 writable, 0 configurable
as that closed sealed frozen 48 keys, 48 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in onNodeHTTPRequest | nobody caught TypeError in markResponseEndedNT | nobody caught TypeError in set | nobody caught TypeError in emitCloseNT | request end  | request close  | answered 200 1 answer | socket close
== a server's response, after the answer: freeze a Proxy, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed frozen 48 keys, 48 found, 0 writable, 0 configurable
as that closed sealed frozen 48 keys, 48 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in onNodeHTTPRequest | nobody caught TypeError in markResponseEndedNT | nobody caught TypeError in set | nobody caught TypeError in emitCloseNT | request end  | request close  | answered 200 1 answer | socket close
== a server's response, after the answer: freeze a Proxy, then used as that
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed frozen 48 keys, 48 found, 0 writable, 0 configurable
as that closed sealed frozen 48 keys, 48 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in onNodeHTTPRequest | nobody caught TypeError in markResponseEndedNT | nobody caught TypeError in set | nobody caught TypeError in emitCloseNT | request end  | request close  | answered 200 1 answer | socket close
== a server's response, after the answer: freeze a Proxy of a Proxy, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed frozen 48 keys, 48 found, 0 writable, 0 configurable
as that closed sealed frozen 48 keys, 48 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in onNodeHTTPRequest | nobody caught TypeError in markResponseEndedNT | nobody caught TypeError in set | nobody caught TypeError in emitCloseNT | request end  | request close  | answered 200 1 answer | socket close
== a server's response, after the answer: freeze a Proxy with every trap, then used itself
traps while closing: 98 of them for a key that is not listed: 0
itself closed sealed frozen 48 keys, 48 found, 0 writable, 0 configurable
as that closed sealed frozen 48 keys, 48 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in onNodeHTTPRequest | nobody caught TypeError in markResponseEndedNT | nobody caught TypeError in set | nobody caught TypeError in emitCloseNT | request end  | request close  | answered 200 1 answer | socket close
== a server's response, after the answer: freeze a Proxy with every trap, then used as that
traps while closing: 98 of them for a key that is not listed: 0
itself closed sealed frozen 48 keys, 48 found, 0 writable, 0 configurable
as that closed sealed frozen 48 keys, 48 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in onNodeHTTPRequest | nobody caught TypeError in markResponseEndedNT | nobody caught TypeError in set | nobody caught TypeError in emitCloseNT | request end  | request close  | answered 200 1 answer | socket close
== a server's response, after the answer: freeze a Proxy with every trap of a Proxy with every trap, then used itself
traps while closing: 439 of them for a key that is not listed: 0
itself closed sealed frozen 48 keys, 48 found, 0 writable, 0 configurable
as that closed sealed frozen 48 keys, 48 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in onNodeHTTPRequest | nobody caught TypeError in markResponseEndedNT | nobody caught TypeError in set | nobody caught TypeError in emitCloseNT | request end  | request close  | answered 200 1 answer | socket close
== a server's response, after the answer: freeze a revoked Proxy, then used itself
closing threw TypeError
traps while closing: 0 of them for a key that is not listed: 0
itself open 48 keys, 48 found, 48 writable, 48 configurable
asking threw TypeError
changing threw TypeError
-- response finish  | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's response, after the answer: freeze a Proxy of a revoked Proxy, then used itself
closing threw TypeError
traps while closing: 0 of them for a key that is not listed: 0
itself open 48 keys, 48 found, 48 writable, 48 configurable
asking threw TypeError
changing threw TypeError
-- response finish  | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's response, after the answer: freeze a Proxy that traps defineProperty, then used itself
traps while closing: 48 of them for a key that is not listed: 0
itself closed sealed frozen 48 keys, 48 found, 0 writable, 0 configurable
as that closed sealed frozen 48 keys, 48 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in onNodeHTTPRequest | nobody caught TypeError in markResponseEndedNT | nobody caught TypeError in set | nobody caught TypeError in emitCloseNT | request end  | request close  | answered 200 1 answer | socket close
== a server's response, after the answer: freeze a Proxy that traps deleteProperty, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed frozen 48 keys, 48 found, 0 writable, 0 configurable
as that closed sealed frozen 48 keys, 48 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in onNodeHTTPRequest | nobody caught TypeError in markResponseEndedNT | nobody caught TypeError in set | nobody caught TypeError in emitCloseNT | request end  | request close  | answered 200 1 answer | socket close
== a server's response, after the answer: freeze a Proxy that traps get, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed frozen 48 keys, 48 found, 0 writable, 0 configurable
as that closed sealed frozen 48 keys, 48 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in onNodeHTTPRequest | nobody caught TypeError in markResponseEndedNT | nobody caught TypeError in set | nobody caught TypeError in emitCloseNT | request end  | request close  | answered 200 1 answer | socket close
== a server's response, after the answer: freeze a Proxy that traps getOwnPropertyDescriptor, then used itself
traps while closing: 48 of them for a key that is not listed: 0
itself closed sealed frozen 48 keys, 48 found, 0 writable, 0 configurable
as that closed sealed frozen 48 keys, 48 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in onNodeHTTPRequest | nobody caught TypeError in markResponseEndedNT | nobody caught TypeError in set | nobody caught TypeError in emitCloseNT | request end  | request close  | answered 200 1 answer | socket close
== a server's response, after the answer: freeze a Proxy that traps getPrototypeOf, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed frozen 48 keys, 48 found, 0 writable, 0 configurable
as that closed sealed frozen 48 keys, 48 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in onNodeHTTPRequest | nobody caught TypeError in markResponseEndedNT | nobody caught TypeError in set | nobody caught TypeError in emitCloseNT | request end  | request close  | answered 200 1 answer | socket close
== a server's response, after the answer: freeze a Proxy that traps has, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed frozen 48 keys, 48 found, 0 writable, 0 configurable
as that closed sealed frozen 48 keys, 48 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in onNodeHTTPRequest | nobody caught TypeError in markResponseEndedNT | nobody caught TypeError in set | nobody caught TypeError in emitCloseNT | request end  | request close  | answered 200 1 answer | socket close
== a server's response, after the answer: freeze a Proxy that traps isExtensible, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed frozen 48 keys, 48 found, 0 writable, 0 configurable
as that closed sealed frozen 48 keys, 48 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in onNodeHTTPRequest | nobody caught TypeError in markResponseEndedNT | nobody caught TypeError in set | nobody caught TypeError in emitCloseNT | request end  | request close  | answered 200 1 answer | socket close
== a server's response, after the answer: freeze a Proxy that traps ownKeys, then used itself
traps while closing: 1 of them for a key that is not listed: 0
itself closed sealed frozen 48 keys, 48 found, 0 writable, 0 configurable
as that closed sealed frozen 48 keys, 48 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in onNodeHTTPRequest | nobody caught TypeError in markResponseEndedNT | nobody caught TypeError in set | nobody caught TypeError in emitCloseNT | request end  | request close  | answered 200 1 answer | socket close
== a server's response, after the answer: freeze a Proxy that traps preventExtensions, then used itself
traps while closing: 1 of them for a key that is not listed: 0
itself closed sealed frozen 48 keys, 48 found, 0 writable, 0 configurable
as that closed sealed frozen 48 keys, 48 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in onNodeHTTPRequest | nobody caught TypeError in markResponseEndedNT | nobody caught TypeError in set | nobody caught TypeError in emitCloseNT | request end  | request close  | answered 200 1 answer | socket close
== a server's response, after the answer: freeze a Proxy that traps set, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed frozen 48 keys, 48 found, 0 writable, 0 configurable
as that closed sealed frozen 48 keys, 48 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in onNodeHTTPRequest | nobody caught TypeError in markResponseEndedNT | nobody caught TypeError in set | nobody caught TypeError in emitCloseNT | request end  | request close  | answered 200 1 answer | socket close
== a server's response, after the answer: seal itself, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 48 keys, 48 found, 48 writable, 0 configurable
as that closed sealed 48 keys, 48 found, 48 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in onNodeHTTPRequest | nobody caught TypeError in markResponseEndedNT | response finish  | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's response, after the answer: seal a Proxy, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 48 keys, 48 found, 48 writable, 0 configurable
as that closed sealed 48 keys, 48 found, 48 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in onNodeHTTPRequest | nobody caught TypeError in markResponseEndedNT | response finish  | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's response, after the answer: seal a Proxy, then used as that
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 48 keys, 48 found, 48 writable, 0 configurable
as that closed sealed 48 keys, 48 found, 48 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in onNodeHTTPRequest | nobody caught TypeError in markResponseEndedNT | response finish  | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's response, after the answer: seal a Proxy of a Proxy, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 48 keys, 48 found, 48 writable, 0 configurable
as that closed sealed 48 keys, 48 found, 48 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in onNodeHTTPRequest | nobody caught TypeError in markResponseEndedNT | response finish  | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's response, after the answer: seal a Proxy with every trap, then used itself
traps while closing: 50 of them for a key that is not listed: 0
itself closed sealed 48 keys, 48 found, 48 writable, 0 configurable
as that closed sealed 48 keys, 48 found, 48 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in onNodeHTTPRequest | nobody caught TypeError in markResponseEndedNT | response finish  | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's response, after the answer: seal a Proxy with every trap, then used as that
traps while closing: 50 of them for a key that is not listed: 0
itself closed sealed 48 keys, 48 found, 48 writable, 0 configurable
as that closed sealed 48 keys, 48 found, 48 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in onNodeHTTPRequest | nobody caught TypeError in markResponseEndedNT | response finish  | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's response, after the answer: seal a Proxy with every trap of a Proxy with every trap, then used itself
traps while closing: 247 of them for a key that is not listed: 0
itself closed sealed 48 keys, 48 found, 48 writable, 0 configurable
as that closed sealed 48 keys, 48 found, 48 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in onNodeHTTPRequest | nobody caught TypeError in markResponseEndedNT | response finish  | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's response, after the answer: seal a revoked Proxy, then used itself
closing threw TypeError
traps while closing: 0 of them for a key that is not listed: 0
itself open 48 keys, 48 found, 48 writable, 48 configurable
asking threw TypeError
changing threw TypeError
-- response finish  | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's response, after the answer: seal a Proxy of a revoked Proxy, then used itself
closing threw TypeError
traps while closing: 0 of them for a key that is not listed: 0
itself open 48 keys, 48 found, 48 writable, 48 configurable
asking threw TypeError
changing threw TypeError
-- response finish  | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's response, after the answer: seal a Proxy that traps defineProperty, then used itself
traps while closing: 48 of them for a key that is not listed: 0
itself closed sealed 48 keys, 48 found, 48 writable, 0 configurable
as that closed sealed 48 keys, 48 found, 48 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in onNodeHTTPRequest | nobody caught TypeError in markResponseEndedNT | response finish  | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's response, after the answer: seal a Proxy that traps deleteProperty, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 48 keys, 48 found, 48 writable, 0 configurable
as that closed sealed 48 keys, 48 found, 48 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in onNodeHTTPRequest | nobody caught TypeError in markResponseEndedNT | response finish  | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's response, after the answer: seal a Proxy that traps get, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 48 keys, 48 found, 48 writable, 0 configurable
as that closed sealed 48 keys, 48 found, 48 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in onNodeHTTPRequest | nobody caught TypeError in markResponseEndedNT | response finish  | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's response, after the answer: seal a Proxy that traps getOwnPropertyDescriptor, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 48 keys, 48 found, 48 writable, 0 configurable
as that closed sealed 48 keys, 48 found, 48 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in onNodeHTTPRequest | nobody caught TypeError in markResponseEndedNT | response finish  | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's response, after the answer: seal a Proxy that traps getPrototypeOf, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 48 keys, 48 found, 48 writable, 0 configurable
as that closed sealed 48 keys, 48 found, 48 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in onNodeHTTPRequest | nobody caught TypeError in markResponseEndedNT | response finish  | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's response, after the answer: seal a Proxy that traps has, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 48 keys, 48 found, 48 writable, 0 configurable
as that closed sealed 48 keys, 48 found, 48 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in onNodeHTTPRequest | nobody caught TypeError in markResponseEndedNT | response finish  | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's response, after the answer: seal a Proxy that traps isExtensible, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 48 keys, 48 found, 48 writable, 0 configurable
as that closed sealed 48 keys, 48 found, 48 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in onNodeHTTPRequest | nobody caught TypeError in markResponseEndedNT | response finish  | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's response, after the answer: seal a Proxy that traps ownKeys, then used itself
traps while closing: 1 of them for a key that is not listed: 0
itself closed sealed 48 keys, 48 found, 48 writable, 0 configurable
as that closed sealed 48 keys, 48 found, 48 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in onNodeHTTPRequest | nobody caught TypeError in markResponseEndedNT | response finish  | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's response, after the answer: seal a Proxy that traps preventExtensions, then used itself
traps while closing: 1 of them for a key that is not listed: 0
itself closed sealed 48 keys, 48 found, 48 writable, 0 configurable
as that closed sealed 48 keys, 48 found, 48 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in onNodeHTTPRequest | nobody caught TypeError in markResponseEndedNT | response finish  | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's response, after the answer: seal a Proxy that traps set, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 48 keys, 48 found, 48 writable, 0 configurable
as that closed sealed 48 keys, 48 found, 48 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in onNodeHTTPRequest | nobody caught TypeError in markResponseEndedNT | response finish  | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's response, after the answer: preventExtensions itself, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 48 keys, 48 found, 48 writable, 48 configurable
as that closed 48 keys, 48 found, 48 writable, 48 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in onNodeHTTPRequest | nobody caught TypeError in markResponseEndedNT | response finish  | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's response, after the answer: preventExtensions a Proxy, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 48 keys, 48 found, 48 writable, 48 configurable
as that closed 48 keys, 48 found, 48 writable, 48 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in onNodeHTTPRequest | nobody caught TypeError in markResponseEndedNT | response finish  | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's response, after the answer: preventExtensions a Proxy, then used as that
traps while closing: 0 of them for a key that is not listed: 0
itself closed 48 keys, 48 found, 48 writable, 48 configurable
as that closed 48 keys, 48 found, 48 writable, 48 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in onNodeHTTPRequest | nobody caught TypeError in markResponseEndedNT | response finish  | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's response, after the answer: preventExtensions a Proxy of a Proxy, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 48 keys, 48 found, 48 writable, 48 configurable
as that closed 48 keys, 48 found, 48 writable, 48 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in onNodeHTTPRequest | nobody caught TypeError in markResponseEndedNT | response finish  | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's response, after the answer: preventExtensions a Proxy with every trap, then used itself
traps while closing: 1 of them for a key that is not listed: 0
itself closed 48 keys, 48 found, 48 writable, 48 configurable
as that closed 48 keys, 48 found, 48 writable, 48 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in onNodeHTTPRequest | nobody caught TypeError in markResponseEndedNT | response finish  | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's response, after the answer: preventExtensions a Proxy with every trap, then used as that
traps while closing: 1 of them for a key that is not listed: 0
itself closed 48 keys, 48 found, 48 writable, 48 configurable
as that closed 48 keys, 48 found, 48 writable, 48 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in onNodeHTTPRequest | nobody caught TypeError in markResponseEndedNT | response finish  | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's response, after the answer: preventExtensions a Proxy with every trap of a Proxy with every trap, then used itself
traps while closing: 3 of them for a key that is not listed: 0
itself closed 48 keys, 48 found, 48 writable, 48 configurable
as that closed 48 keys, 48 found, 48 writable, 48 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in onNodeHTTPRequest | nobody caught TypeError in markResponseEndedNT | response finish  | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's response, after the answer: preventExtensions a revoked Proxy, then used itself
closing threw TypeError
traps while closing: 0 of them for a key that is not listed: 0
itself open 48 keys, 48 found, 48 writable, 48 configurable
asking threw TypeError
changing threw TypeError
-- response finish  | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's response, after the answer: preventExtensions a Proxy of a revoked Proxy, then used itself
closing threw TypeError
traps while closing: 0 of them for a key that is not listed: 0
itself open 48 keys, 48 found, 48 writable, 48 configurable
asking threw TypeError
changing threw TypeError
-- response finish  | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's response, after the answer: preventExtensions a Proxy that traps defineProperty, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 48 keys, 48 found, 48 writable, 48 configurable
as that closed 48 keys, 48 found, 48 writable, 48 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in onNodeHTTPRequest | nobody caught TypeError in markResponseEndedNT | response finish  | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's response, after the answer: preventExtensions a Proxy that traps deleteProperty, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 48 keys, 48 found, 48 writable, 48 configurable
as that closed 48 keys, 48 found, 48 writable, 48 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in onNodeHTTPRequest | nobody caught TypeError in markResponseEndedNT | response finish  | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's response, after the answer: preventExtensions a Proxy that traps get, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 48 keys, 48 found, 48 writable, 48 configurable
as that closed 48 keys, 48 found, 48 writable, 48 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in onNodeHTTPRequest | nobody caught TypeError in markResponseEndedNT | response finish  | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's response, after the answer: preventExtensions a Proxy that traps getOwnPropertyDescriptor, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 48 keys, 48 found, 48 writable, 48 configurable
as that closed 48 keys, 48 found, 48 writable, 48 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in onNodeHTTPRequest | nobody caught TypeError in markResponseEndedNT | response finish  | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's response, after the answer: preventExtensions a Proxy that traps getPrototypeOf, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 48 keys, 48 found, 48 writable, 48 configurable
as that closed 48 keys, 48 found, 48 writable, 48 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in onNodeHTTPRequest | nobody caught TypeError in markResponseEndedNT | response finish  | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's response, after the answer: preventExtensions a Proxy that traps has, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 48 keys, 48 found, 48 writable, 48 configurable
as that closed 48 keys, 48 found, 48 writable, 48 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in onNodeHTTPRequest | nobody caught TypeError in markResponseEndedNT | response finish  | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's response, after the answer: preventExtensions a Proxy that traps isExtensible, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 48 keys, 48 found, 48 writable, 48 configurable
as that closed 48 keys, 48 found, 48 writable, 48 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in onNodeHTTPRequest | nobody caught TypeError in markResponseEndedNT | response finish  | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's response, after the answer: preventExtensions a Proxy that traps ownKeys, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 48 keys, 48 found, 48 writable, 48 configurable
as that closed 48 keys, 48 found, 48 writable, 48 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in onNodeHTTPRequest | nobody caught TypeError in markResponseEndedNT | response finish  | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's response, after the answer: preventExtensions a Proxy that traps preventExtensions, then used itself
traps while closing: 1 of them for a key that is not listed: 0
itself closed 48 keys, 48 found, 48 writable, 48 configurable
as that closed 48 keys, 48 found, 48 writable, 48 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in onNodeHTTPRequest | nobody caught TypeError in markResponseEndedNT | response finish  | response close  | request end  | request close  | answered 200 1 answer | socket close
== a server's response, after the answer: preventExtensions a Proxy that traps set, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 48 keys, 48 found, 48 writable, 48 configurable
as that closed 48 keys, 48 found, 48 writable, 48 configurable
defined anew true added false removed true absent removed true absent found false
-- nobody caught TypeError in onNodeHTTPRequest | nobody caught TypeError in markResponseEndedNT | response finish  | response close  | request end  | request close  | answered 200 1 answer | socket close
== a client's request: nothing itself, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself open 60 keys, 60 found, 60 writable, 60 configurable
as that open 60 keys, 60 found, 60 writable, 60 configurable
defined anew true added true removed true absent removed true absent found false
-- request finish  | response end  | response close | request close 
== a client's request: seal itself, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 60 keys, 60 found, 60 writable, 0 configurable
as that closed sealed 60 keys, 60 found, 60 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- request finish  | response end  | response close | request close 
== a client's request: seal a Proxy, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 60 keys, 60 found, 60 writable, 0 configurable
as that closed sealed 60 keys, 60 found, 60 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- request finish  | response end  | response close | request close 
== a client's request: seal a Proxy, then used as that
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 60 keys, 60 found, 60 writable, 0 configurable
as that closed sealed 60 keys, 60 found, 60 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- request finish  | response end  | response close | request close 
== a client's request: seal a Proxy of a Proxy, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 60 keys, 60 found, 60 writable, 0 configurable
as that closed sealed 60 keys, 60 found, 60 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- request finish  | response end  | response close | request close 
== a client's request: seal a Proxy with every trap, then used itself
traps while closing: 62 of them for a key that is not listed: 0
itself closed sealed 60 keys, 60 found, 60 writable, 0 configurable
as that closed sealed 60 keys, 60 found, 60 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- request finish  | response end  | response close | request close 
== a client's request: seal a Proxy with every trap, then used as that
traps while closing: 62 of them for a key that is not listed: 0
itself closed sealed 60 keys, 60 found, 60 writable, 0 configurable
as that closed sealed 60 keys, 60 found, 60 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- request finish  | response end  | response close | request close 
== a client's request: seal a Proxy with every trap of a Proxy with every trap, then used itself
traps while closing: 307 of them for a key that is not listed: 0
itself closed sealed 60 keys, 60 found, 60 writable, 0 configurable
as that closed sealed 60 keys, 60 found, 60 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- request finish  | response end  | response close | request close 
== a client's request: seal a revoked Proxy, then used itself
closing threw TypeError
traps while closing: 0 of them for a key that is not listed: 0
itself open 60 keys, 60 found, 60 writable, 60 configurable
asking threw TypeError
changing threw TypeError
-- request finish  | response end  | response close | request close 
== a client's request: seal a Proxy of a revoked Proxy, then used itself
closing threw TypeError
traps while closing: 0 of them for a key that is not listed: 0
itself open 60 keys, 60 found, 60 writable, 60 configurable
asking threw TypeError
changing threw TypeError
-- request finish  | response end  | response close | request close 
== a client's request: seal a Proxy that traps defineProperty, then used itself
traps while closing: 60 of them for a key that is not listed: 0
itself closed sealed 60 keys, 60 found, 60 writable, 0 configurable
as that closed sealed 60 keys, 60 found, 60 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- request finish  | response end  | response close | request close 
== a client's request: seal a Proxy that traps deleteProperty, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 60 keys, 60 found, 60 writable, 0 configurable
as that closed sealed 60 keys, 60 found, 60 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- request finish  | response end  | response close | request close 
== a client's request: seal a Proxy that traps get, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 60 keys, 60 found, 60 writable, 0 configurable
as that closed sealed 60 keys, 60 found, 60 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- request finish  | response end  | response close | request close 
== a client's request: seal a Proxy that traps getOwnPropertyDescriptor, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 60 keys, 60 found, 60 writable, 0 configurable
as that closed sealed 60 keys, 60 found, 60 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- request finish  | response end  | response close | request close 
== a client's request: seal a Proxy that traps getPrototypeOf, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 60 keys, 60 found, 60 writable, 0 configurable
as that closed sealed 60 keys, 60 found, 60 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- request finish  | response end  | response close | request close 
== a client's request: seal a Proxy that traps has, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 60 keys, 60 found, 60 writable, 0 configurable
as that closed sealed 60 keys, 60 found, 60 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- request finish  | response end  | response close | request close 
== a client's request: seal a Proxy that traps isExtensible, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 60 keys, 60 found, 60 writable, 0 configurable
as that closed sealed 60 keys, 60 found, 60 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- request finish  | response end  | response close | request close 
== a client's request: seal a Proxy that traps ownKeys, then used itself
traps while closing: 1 of them for a key that is not listed: 0
itself closed sealed 60 keys, 60 found, 60 writable, 0 configurable
as that closed sealed 60 keys, 60 found, 60 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- request finish  | response end  | response close | request close 
== a client's request: seal a Proxy that traps preventExtensions, then used itself
traps while closing: 1 of them for a key that is not listed: 0
itself closed sealed 60 keys, 60 found, 60 writable, 0 configurable
as that closed sealed 60 keys, 60 found, 60 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- request finish  | response end  | response close | request close 
== a client's request: seal a Proxy that traps set, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 60 keys, 60 found, 60 writable, 0 configurable
as that closed sealed 60 keys, 60 found, 60 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- request finish  | response end  | response close | request close 
== a client's request: preventExtensions itself, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 60 keys, 60 found, 60 writable, 60 configurable
as that closed 60 keys, 60 found, 60 writable, 60 configurable
defined anew true added false removed true absent removed true absent found false
-- request finish  | response end  | response close | request close 
== a client's request: preventExtensions a Proxy, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 60 keys, 60 found, 60 writable, 60 configurable
as that closed 60 keys, 60 found, 60 writable, 60 configurable
defined anew true added false removed true absent removed true absent found false
-- request finish  | response end  | response close | request close 
== a client's request: preventExtensions a Proxy, then used as that
traps while closing: 0 of them for a key that is not listed: 0
itself closed 60 keys, 60 found, 60 writable, 60 configurable
as that closed 60 keys, 60 found, 60 writable, 60 configurable
defined anew true added false removed true absent removed true absent found false
-- request finish  | response end  | response close | request close 
== a client's request: preventExtensions a Proxy of a Proxy, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 60 keys, 60 found, 60 writable, 60 configurable
as that closed 60 keys, 60 found, 60 writable, 60 configurable
defined anew true added false removed true absent removed true absent found false
-- request finish  | response end  | response close | request close 
== a client's request: preventExtensions a Proxy with every trap, then used itself
traps while closing: 1 of them for a key that is not listed: 0
itself closed 60 keys, 60 found, 60 writable, 60 configurable
as that closed 60 keys, 60 found, 60 writable, 60 configurable
defined anew true added false removed true absent removed true absent found false
-- request finish  | response end  | response close | request close 
== a client's request: preventExtensions a Proxy with every trap, then used as that
traps while closing: 1 of them for a key that is not listed: 0
itself closed 60 keys, 60 found, 60 writable, 60 configurable
as that closed 60 keys, 60 found, 60 writable, 60 configurable
defined anew true added false removed true absent removed true absent found false
-- request finish  | response end  | response close | request close 
== a client's request: preventExtensions a Proxy with every trap of a Proxy with every trap, then used itself
traps while closing: 3 of them for a key that is not listed: 0
itself closed 60 keys, 60 found, 60 writable, 60 configurable
as that closed 60 keys, 60 found, 60 writable, 60 configurable
defined anew true added false removed true absent removed true absent found false
-- request finish  | response end  | response close | request close 
== a client's request: preventExtensions a revoked Proxy, then used itself
closing threw TypeError
traps while closing: 0 of them for a key that is not listed: 0
itself open 60 keys, 60 found, 60 writable, 60 configurable
asking threw TypeError
changing threw TypeError
-- request finish  | response end  | response close | request close 
== a client's request: preventExtensions a Proxy of a revoked Proxy, then used itself
closing threw TypeError
traps while closing: 0 of them for a key that is not listed: 0
itself open 60 keys, 60 found, 60 writable, 60 configurable
asking threw TypeError
changing threw TypeError
-- request finish  | response end  | response close | request close 
== a client's request: preventExtensions a Proxy that traps defineProperty, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 60 keys, 60 found, 60 writable, 60 configurable
as that closed 60 keys, 60 found, 60 writable, 60 configurable
defined anew true added false removed true absent removed true absent found false
-- request finish  | response end  | response close | request close 
== a client's request: preventExtensions a Proxy that traps deleteProperty, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 60 keys, 60 found, 60 writable, 60 configurable
as that closed 60 keys, 60 found, 60 writable, 60 configurable
defined anew true added false removed true absent removed true absent found false
-- request finish  | response end  | response close | request close 
== a client's request: preventExtensions a Proxy that traps get, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 60 keys, 60 found, 60 writable, 60 configurable
as that closed 60 keys, 60 found, 60 writable, 60 configurable
defined anew true added false removed true absent removed true absent found false
-- request finish  | response end  | response close | request close 
== a client's request: preventExtensions a Proxy that traps getOwnPropertyDescriptor, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 60 keys, 60 found, 60 writable, 60 configurable
as that closed 60 keys, 60 found, 60 writable, 60 configurable
defined anew true added false removed true absent removed true absent found false
-- request finish  | response end  | response close | request close 
== a client's request: preventExtensions a Proxy that traps getPrototypeOf, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 60 keys, 60 found, 60 writable, 60 configurable
as that closed 60 keys, 60 found, 60 writable, 60 configurable
defined anew true added false removed true absent removed true absent found false
-- request finish  | response end  | response close | request close 
== a client's request: preventExtensions a Proxy that traps has, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 60 keys, 60 found, 60 writable, 60 configurable
as that closed 60 keys, 60 found, 60 writable, 60 configurable
defined anew true added false removed true absent removed true absent found false
-- request finish  | response end  | response close | request close 
== a client's request: preventExtensions a Proxy that traps isExtensible, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 60 keys, 60 found, 60 writable, 60 configurable
as that closed 60 keys, 60 found, 60 writable, 60 configurable
defined anew true added false removed true absent removed true absent found false
-- request finish  | response end  | response close | request close 
== a client's request: preventExtensions a Proxy that traps ownKeys, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 60 keys, 60 found, 60 writable, 60 configurable
as that closed 60 keys, 60 found, 60 writable, 60 configurable
defined anew true added false removed true absent removed true absent found false
-- request finish  | response end  | response close | request close 
== a client's request: preventExtensions a Proxy that traps preventExtensions, then used itself
traps while closing: 1 of them for a key that is not listed: 0
itself closed 60 keys, 60 found, 60 writable, 60 configurable
as that closed 60 keys, 60 found, 60 writable, 60 configurable
defined anew true added false removed true absent removed true absent found false
-- request finish  | response end  | response close | request close 
== a client's request: preventExtensions a Proxy that traps set, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 60 keys, 60 found, 60 writable, 60 configurable
as that closed 60 keys, 60 found, 60 writable, 60 configurable
defined anew true added false removed true absent removed true absent found false
-- request finish  | response end  | response close | request close 
== a client's response: nothing itself, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself open 34 keys, 34 found, 34 writable, 34 configurable
as that open 34 keys, 34 found, 34 writable, 34 configurable
defined anew true added true removed true absent removed true absent found false
-- request finish  | response end  | response close | request close 
== a client's response: freeze itself, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed frozen 34 keys, 34 found, 0 writable, 0 configurable
as that closed sealed frozen 34 keys, 34 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- request finish  | nobody caught TypeError in parserOnMessageComplete | response error TypeError in _destroy | response close | request close 
== a client's response: freeze a Proxy, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed frozen 34 keys, 34 found, 0 writable, 0 configurable
as that closed sealed frozen 34 keys, 34 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- request finish  | nobody caught TypeError in parserOnMessageComplete | response error TypeError in _destroy | response close | request close 
== a client's response: freeze a Proxy, then used as that
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed frozen 34 keys, 34 found, 0 writable, 0 configurable
as that closed sealed frozen 34 keys, 34 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- request finish  | nobody caught TypeError in parserOnMessageComplete | response error TypeError in _destroy | response close | request close 
== a client's response: freeze a Proxy of a Proxy, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed frozen 34 keys, 34 found, 0 writable, 0 configurable
as that closed sealed frozen 34 keys, 34 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- request finish  | nobody caught TypeError in parserOnMessageComplete | response error TypeError in _destroy | response close | request close 
== a client's response: freeze a Proxy with every trap, then used itself
traps while closing: 70 of them for a key that is not listed: 0
itself closed sealed frozen 34 keys, 34 found, 0 writable, 0 configurable
as that closed sealed frozen 34 keys, 34 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- request finish  | nobody caught TypeError in parserOnMessageComplete | response error TypeError in _destroy | response close | request close 
== a client's response: freeze a Proxy with every trap, then used as that
traps while closing: 70 of them for a key that is not listed: 0
itself closed sealed frozen 34 keys, 34 found, 0 writable, 0 configurable
as that closed sealed frozen 34 keys, 34 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- request finish  | nobody caught TypeError in parserOnMessageComplete | response error TypeError in _destroy | response close | request close 
== a client's response: freeze a Proxy with every trap of a Proxy with every trap, then used itself
traps while closing: 313 of them for a key that is not listed: 0
itself closed sealed frozen 34 keys, 34 found, 0 writable, 0 configurable
as that closed sealed frozen 34 keys, 34 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- request finish  | nobody caught TypeError in parserOnMessageComplete | response error TypeError in _destroy | response close | request close 
== a client's response: freeze a revoked Proxy, then used itself
closing threw TypeError
traps while closing: 0 of them for a key that is not listed: 0
itself open 34 keys, 34 found, 34 writable, 34 configurable
asking threw TypeError
changing threw TypeError
-- request finish  | response end  | response close | request close 
== a client's response: freeze a Proxy of a revoked Proxy, then used itself
closing threw TypeError
traps while closing: 0 of them for a key that is not listed: 0
itself open 34 keys, 34 found, 34 writable, 34 configurable
asking threw TypeError
changing threw TypeError
-- request finish  | response end  | response close | request close 
== a client's response: freeze a Proxy that traps defineProperty, then used itself
traps while closing: 34 of them for a key that is not listed: 0
itself closed sealed frozen 34 keys, 34 found, 0 writable, 0 configurable
as that closed sealed frozen 34 keys, 34 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- request finish  | nobody caught TypeError in parserOnMessageComplete | response error TypeError in _destroy | response close | request close 
== a client's response: freeze a Proxy that traps deleteProperty, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed frozen 34 keys, 34 found, 0 writable, 0 configurable
as that closed sealed frozen 34 keys, 34 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- request finish  | nobody caught TypeError in parserOnMessageComplete | response error TypeError in _destroy | response close | request close 
== a client's response: freeze a Proxy that traps get, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed frozen 34 keys, 34 found, 0 writable, 0 configurable
as that closed sealed frozen 34 keys, 34 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- request finish  | nobody caught TypeError in parserOnMessageComplete | response error TypeError in _destroy | response close | request close 
== a client's response: freeze a Proxy that traps getOwnPropertyDescriptor, then used itself
traps while closing: 34 of them for a key that is not listed: 0
itself closed sealed frozen 34 keys, 34 found, 0 writable, 0 configurable
as that closed sealed frozen 34 keys, 34 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- request finish  | nobody caught TypeError in parserOnMessageComplete | response error TypeError in _destroy | response close | request close 
== a client's response: freeze a Proxy that traps getPrototypeOf, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed frozen 34 keys, 34 found, 0 writable, 0 configurable
as that closed sealed frozen 34 keys, 34 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- request finish  | nobody caught TypeError in parserOnMessageComplete | response error TypeError in _destroy | response close | request close 
== a client's response: freeze a Proxy that traps has, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed frozen 34 keys, 34 found, 0 writable, 0 configurable
as that closed sealed frozen 34 keys, 34 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- request finish  | nobody caught TypeError in parserOnMessageComplete | response error TypeError in _destroy | response close | request close 
== a client's response: freeze a Proxy that traps isExtensible, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed frozen 34 keys, 34 found, 0 writable, 0 configurable
as that closed sealed frozen 34 keys, 34 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- request finish  | nobody caught TypeError in parserOnMessageComplete | response error TypeError in _destroy | response close | request close 
== a client's response: freeze a Proxy that traps ownKeys, then used itself
traps while closing: 1 of them for a key that is not listed: 0
itself closed sealed frozen 34 keys, 34 found, 0 writable, 0 configurable
as that closed sealed frozen 34 keys, 34 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- request finish  | nobody caught TypeError in parserOnMessageComplete | response error TypeError in _destroy | response close | request close 
== a client's response: freeze a Proxy that traps preventExtensions, then used itself
traps while closing: 1 of them for a key that is not listed: 0
itself closed sealed frozen 34 keys, 34 found, 0 writable, 0 configurable
as that closed sealed frozen 34 keys, 34 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- request finish  | nobody caught TypeError in parserOnMessageComplete | response error TypeError in _destroy | response close | request close 
== a client's response: freeze a Proxy that traps set, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed frozen 34 keys, 34 found, 0 writable, 0 configurable
as that closed sealed frozen 34 keys, 34 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- request finish  | nobody caught TypeError in parserOnMessageComplete | response error TypeError in _destroy | response close | request close 
== a client's response: seal itself, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 34 keys, 34 found, 34 writable, 0 configurable
as that closed sealed 34 keys, 34 found, 34 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- request finish  | response end  | nobody caught TypeError in endReadableNT | request close  | the response's close did not come
== a client's response: seal a Proxy, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 34 keys, 34 found, 34 writable, 0 configurable
as that closed sealed 34 keys, 34 found, 34 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- request finish  | response end  | nobody caught TypeError in endReadableNT | request close  | the response's close did not come
== a client's response: seal a Proxy, then used as that
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 34 keys, 34 found, 34 writable, 0 configurable
as that closed sealed 34 keys, 34 found, 34 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- request finish  | response end  | nobody caught TypeError in endReadableNT | request close  | the response's close did not come
== a client's response: seal a Proxy of a Proxy, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 34 keys, 34 found, 34 writable, 0 configurable
as that closed sealed 34 keys, 34 found, 34 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- request finish  | response end  | nobody caught TypeError in endReadableNT | request close  | the response's close did not come
== a client's response: seal a Proxy with every trap, then used itself
traps while closing: 36 of them for a key that is not listed: 0
itself closed sealed 34 keys, 34 found, 34 writable, 0 configurable
as that closed sealed 34 keys, 34 found, 34 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- request finish  | response end  | nobody caught TypeError in endReadableNT | request close  | the response's close did not come
== a client's response: seal a Proxy with every trap, then used as that
traps while closing: 36 of them for a key that is not listed: 0
itself closed sealed 34 keys, 34 found, 34 writable, 0 configurable
as that closed sealed 34 keys, 34 found, 34 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- request finish  | response end  | nobody caught TypeError in endReadableNT | request close  | the response's close did not come
== a client's response: seal a Proxy with every trap of a Proxy with every trap, then used itself
traps while closing: 177 of them for a key that is not listed: 0
itself closed sealed 34 keys, 34 found, 34 writable, 0 configurable
as that closed sealed 34 keys, 34 found, 34 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- request finish  | response end  | nobody caught TypeError in endReadableNT | request close  | the response's close did not come
== a client's response: seal a revoked Proxy, then used itself
closing threw TypeError
traps while closing: 0 of them for a key that is not listed: 0
itself open 34 keys, 34 found, 34 writable, 34 configurable
asking threw TypeError
changing threw TypeError
-- request finish  | response end  | response close | request close 
== a client's response: seal a Proxy of a revoked Proxy, then used itself
closing threw TypeError
traps while closing: 0 of them for a key that is not listed: 0
itself open 34 keys, 34 found, 34 writable, 34 configurable
asking threw TypeError
changing threw TypeError
-- request finish  | response end  | response close | request close 
== a client's response: seal a Proxy that traps defineProperty, then used itself
traps while closing: 34 of them for a key that is not listed: 0
itself closed sealed 34 keys, 34 found, 34 writable, 0 configurable
as that closed sealed 34 keys, 34 found, 34 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- request finish  | response end  | nobody caught TypeError in endReadableNT | request close  | the response's close did not come
== a client's response: seal a Proxy that traps deleteProperty, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 34 keys, 34 found, 34 writable, 0 configurable
as that closed sealed 34 keys, 34 found, 34 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- request finish  | response end  | nobody caught TypeError in endReadableNT | request close  | the response's close did not come
== a client's response: seal a Proxy that traps get, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 34 keys, 34 found, 34 writable, 0 configurable
as that closed sealed 34 keys, 34 found, 34 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- request finish  | response end  | nobody caught TypeError in endReadableNT | request close  | the response's close did not come
== a client's response: seal a Proxy that traps getOwnPropertyDescriptor, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 34 keys, 34 found, 34 writable, 0 configurable
as that closed sealed 34 keys, 34 found, 34 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- request finish  | response end  | nobody caught TypeError in endReadableNT | request close  | the response's close did not come
== a client's response: seal a Proxy that traps getPrototypeOf, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 34 keys, 34 found, 34 writable, 0 configurable
as that closed sealed 34 keys, 34 found, 34 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- request finish  | response end  | nobody caught TypeError in endReadableNT | request close  | the response's close did not come
== a client's response: seal a Proxy that traps has, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 34 keys, 34 found, 34 writable, 0 configurable
as that closed sealed 34 keys, 34 found, 34 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- request finish  | response end  | nobody caught TypeError in endReadableNT | request close  | the response's close did not come
== a client's response: seal a Proxy that traps isExtensible, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 34 keys, 34 found, 34 writable, 0 configurable
as that closed sealed 34 keys, 34 found, 34 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- request finish  | response end  | nobody caught TypeError in endReadableNT | request close  | the response's close did not come
== a client's response: seal a Proxy that traps ownKeys, then used itself
traps while closing: 1 of them for a key that is not listed: 0
itself closed sealed 34 keys, 34 found, 34 writable, 0 configurable
as that closed sealed 34 keys, 34 found, 34 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- request finish  | response end  | nobody caught TypeError in endReadableNT | request close  | the response's close did not come
== a client's response: seal a Proxy that traps preventExtensions, then used itself
traps while closing: 1 of them for a key that is not listed: 0
itself closed sealed 34 keys, 34 found, 34 writable, 0 configurable
as that closed sealed 34 keys, 34 found, 34 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- request finish  | response end  | nobody caught TypeError in endReadableNT | request close  | the response's close did not come
== a client's response: seal a Proxy that traps set, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 34 keys, 34 found, 34 writable, 0 configurable
as that closed sealed 34 keys, 34 found, 34 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- request finish  | response end  | nobody caught TypeError in endReadableNT | request close  | the response's close did not come
== a client's response: preventExtensions itself, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 34 keys, 34 found, 34 writable, 34 configurable
as that closed 34 keys, 34 found, 34 writable, 34 configurable
defined anew true added false removed true absent removed true absent found false
-- request finish  | response end  | nobody caught TypeError in endReadableNT | request close  | the response's close did not come
== a client's response: preventExtensions a Proxy, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 34 keys, 34 found, 34 writable, 34 configurable
as that closed 34 keys, 34 found, 34 writable, 34 configurable
defined anew true added false removed true absent removed true absent found false
-- request finish  | response end  | nobody caught TypeError in endReadableNT | request close  | the response's close did not come
== a client's response: preventExtensions a Proxy, then used as that
traps while closing: 0 of them for a key that is not listed: 0
itself closed 34 keys, 34 found, 34 writable, 34 configurable
as that closed 34 keys, 34 found, 34 writable, 34 configurable
defined anew true added false removed true absent removed true absent found false
-- request finish  | response end  | nobody caught TypeError in endReadableNT | request close  | the response's close did not come
== a client's response: preventExtensions a Proxy of a Proxy, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 34 keys, 34 found, 34 writable, 34 configurable
as that closed 34 keys, 34 found, 34 writable, 34 configurable
defined anew true added false removed true absent removed true absent found false
-- request finish  | response end  | nobody caught TypeError in endReadableNT | request close  | the response's close did not come
== a client's response: preventExtensions a Proxy with every trap, then used itself
traps while closing: 1 of them for a key that is not listed: 0
itself closed 34 keys, 34 found, 34 writable, 34 configurable
as that closed 34 keys, 34 found, 34 writable, 34 configurable
defined anew true added false removed true absent removed true absent found false
-- request finish  | response end  | nobody caught TypeError in endReadableNT | request close  | the response's close did not come
== a client's response: preventExtensions a Proxy with every trap, then used as that
traps while closing: 1 of them for a key that is not listed: 0
itself closed 34 keys, 34 found, 34 writable, 34 configurable
as that closed 34 keys, 34 found, 34 writable, 34 configurable
defined anew true added false removed true absent removed true absent found false
-- request finish  | response end  | nobody caught TypeError in endReadableNT | request close  | the response's close did not come
== a client's response: preventExtensions a Proxy with every trap of a Proxy with every trap, then used itself
traps while closing: 3 of them for a key that is not listed: 0
itself closed 34 keys, 34 found, 34 writable, 34 configurable
as that closed 34 keys, 34 found, 34 writable, 34 configurable
defined anew true added false removed true absent removed true absent found false
-- request finish  | response end  | nobody caught TypeError in endReadableNT | request close  | the response's close did not come
== a client's response: preventExtensions a revoked Proxy, then used itself
closing threw TypeError
traps while closing: 0 of them for a key that is not listed: 0
itself open 34 keys, 34 found, 34 writable, 34 configurable
asking threw TypeError
changing threw TypeError
-- request finish  | response end  | response close | request close 
== a client's response: preventExtensions a Proxy of a revoked Proxy, then used itself
closing threw TypeError
traps while closing: 0 of them for a key that is not listed: 0
itself open 34 keys, 34 found, 34 writable, 34 configurable
asking threw TypeError
changing threw TypeError
-- request finish  | response end  | response close | request close 
== a client's response: preventExtensions a Proxy that traps defineProperty, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 34 keys, 34 found, 34 writable, 34 configurable
as that closed 34 keys, 34 found, 34 writable, 34 configurable
defined anew true added false removed true absent removed true absent found false
-- request finish  | response end  | nobody caught TypeError in endReadableNT | request close  | the response's close did not come
== a client's response: preventExtensions a Proxy that traps deleteProperty, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 34 keys, 34 found, 34 writable, 34 configurable
as that closed 34 keys, 34 found, 34 writable, 34 configurable
defined anew true added false removed true absent removed true absent found false
-- request finish  | response end  | nobody caught TypeError in endReadableNT | request close  | the response's close did not come
== a client's response: preventExtensions a Proxy that traps get, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 34 keys, 34 found, 34 writable, 34 configurable
as that closed 34 keys, 34 found, 34 writable, 34 configurable
defined anew true added false removed true absent removed true absent found false
-- request finish  | response end  | nobody caught TypeError in endReadableNT | request close  | the response's close did not come
== a client's response: preventExtensions a Proxy that traps getOwnPropertyDescriptor, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 34 keys, 34 found, 34 writable, 34 configurable
as that closed 34 keys, 34 found, 34 writable, 34 configurable
defined anew true added false removed true absent removed true absent found false
-- request finish  | response end  | nobody caught TypeError in endReadableNT | request close  | the response's close did not come
== a client's response: preventExtensions a Proxy that traps getPrototypeOf, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 34 keys, 34 found, 34 writable, 34 configurable
as that closed 34 keys, 34 found, 34 writable, 34 configurable
defined anew true added false removed true absent removed true absent found false
-- request finish  | response end  | nobody caught TypeError in endReadableNT | request close  | the response's close did not come
== a client's response: preventExtensions a Proxy that traps has, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 34 keys, 34 found, 34 writable, 34 configurable
as that closed 34 keys, 34 found, 34 writable, 34 configurable
defined anew true added false removed true absent removed true absent found false
-- request finish  | response end  | nobody caught TypeError in endReadableNT | request close  | the response's close did not come
== a client's response: preventExtensions a Proxy that traps isExtensible, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 34 keys, 34 found, 34 writable, 34 configurable
as that closed 34 keys, 34 found, 34 writable, 34 configurable
defined anew true added false removed true absent removed true absent found false
-- request finish  | response end  | nobody caught TypeError in endReadableNT | request close  | the response's close did not come
== a client's response: preventExtensions a Proxy that traps ownKeys, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 34 keys, 34 found, 34 writable, 34 configurable
as that closed 34 keys, 34 found, 34 writable, 34 configurable
defined anew true added false removed true absent removed true absent found false
-- request finish  | response end  | nobody caught TypeError in endReadableNT | request close  | the response's close did not come
== a client's response: preventExtensions a Proxy that traps preventExtensions, then used itself
traps while closing: 1 of them for a key that is not listed: 0
itself closed 34 keys, 34 found, 34 writable, 34 configurable
as that closed 34 keys, 34 found, 34 writable, 34 configurable
defined anew true added false removed true absent removed true absent found false
-- request finish  | response end  | nobody caught TypeError in endReadableNT | request close  | the response's close did not come
== a client's response: preventExtensions a Proxy that traps set, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 34 keys, 34 found, 34 writable, 34 configurable
as that closed 34 keys, 34 found, 34 writable, 34 configurable
defined anew true added false removed true absent removed true absent found false
-- request finish  | response end  | nobody caught TypeError in endReadableNT | request close  | the response's close did not come
== a client's socket: nothing itself, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself open 45 keys, 45 found, 45 writable, 45 configurable
as that open 45 keys, 45 found, 45 writable, 45 configurable
defined anew true added true removed true absent removed true absent found false
-- request finish  | response end  | response close | request close 
== a client's socket: seal itself, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 45 keys, 45 found, 45 writable, 0 configurable
as that closed sealed 45 keys, 45 found, 45 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- request finish  | response end  | response close | request close 
== a client's socket: seal a Proxy, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 45 keys, 45 found, 45 writable, 0 configurable
as that closed sealed 45 keys, 45 found, 45 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- request finish  | response end  | response close | request close 
== a client's socket: seal a Proxy, then used as that
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 45 keys, 45 found, 45 writable, 0 configurable
as that closed sealed 45 keys, 45 found, 45 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- request finish  | response end  | response close | request close 
== a client's socket: seal a Proxy of a Proxy, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 45 keys, 45 found, 45 writable, 0 configurable
as that closed sealed 45 keys, 45 found, 45 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- request finish  | response end  | response close | request close 
== a client's socket: seal a Proxy with every trap, then used itself
traps while closing: 47 of them for a key that is not listed: 0
itself closed sealed 45 keys, 45 found, 45 writable, 0 configurable
as that closed sealed 45 keys, 45 found, 45 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- request finish  | response end  | response close | request close 
== a client's socket: seal a Proxy with every trap, then used as that
traps while closing: 47 of them for a key that is not listed: 0
itself closed sealed 45 keys, 45 found, 45 writable, 0 configurable
as that closed sealed 45 keys, 45 found, 45 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- request finish  | response end  | response close | request close 
== a client's socket: seal a Proxy with every trap of a Proxy with every trap, then used itself
traps while closing: 232 of them for a key that is not listed: 0
itself closed sealed 45 keys, 45 found, 45 writable, 0 configurable
as that closed sealed 45 keys, 45 found, 45 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- request finish  | response end  | response close | request close 
== a client's socket: seal a revoked Proxy, then used itself
closing threw TypeError
traps while closing: 0 of them for a key that is not listed: 0
itself open 45 keys, 45 found, 45 writable, 45 configurable
asking threw TypeError
changing threw TypeError
-- request finish  | response end  | response close | request close 
== a client's socket: seal a Proxy of a revoked Proxy, then used itself
closing threw TypeError
traps while closing: 0 of them for a key that is not listed: 0
itself open 45 keys, 45 found, 45 writable, 45 configurable
asking threw TypeError
changing threw TypeError
-- request finish  | response end  | response close | request close 
== a client's socket: seal a Proxy that traps defineProperty, then used itself
traps while closing: 45 of them for a key that is not listed: 0
itself closed sealed 45 keys, 45 found, 45 writable, 0 configurable
as that closed sealed 45 keys, 45 found, 45 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- request finish  | response end  | response close | request close 
== a client's socket: seal a Proxy that traps deleteProperty, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 45 keys, 45 found, 45 writable, 0 configurable
as that closed sealed 45 keys, 45 found, 45 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- request finish  | response end  | response close | request close 
== a client's socket: seal a Proxy that traps get, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 45 keys, 45 found, 45 writable, 0 configurable
as that closed sealed 45 keys, 45 found, 45 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- request finish  | response end  | response close | request close 
== a client's socket: seal a Proxy that traps getOwnPropertyDescriptor, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 45 keys, 45 found, 45 writable, 0 configurable
as that closed sealed 45 keys, 45 found, 45 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- request finish  | response end  | response close | request close 
== a client's socket: seal a Proxy that traps getPrototypeOf, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 45 keys, 45 found, 45 writable, 0 configurable
as that closed sealed 45 keys, 45 found, 45 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- request finish  | response end  | response close | request close 
== a client's socket: seal a Proxy that traps has, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 45 keys, 45 found, 45 writable, 0 configurable
as that closed sealed 45 keys, 45 found, 45 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- request finish  | response end  | response close | request close 
== a client's socket: seal a Proxy that traps isExtensible, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 45 keys, 45 found, 45 writable, 0 configurable
as that closed sealed 45 keys, 45 found, 45 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- request finish  | response end  | response close | request close 
== a client's socket: seal a Proxy that traps ownKeys, then used itself
traps while closing: 1 of them for a key that is not listed: 0
itself closed sealed 45 keys, 45 found, 45 writable, 0 configurable
as that closed sealed 45 keys, 45 found, 45 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- request finish  | response end  | response close | request close 
== a client's socket: seal a Proxy that traps preventExtensions, then used itself
traps while closing: 1 of them for a key that is not listed: 0
itself closed sealed 45 keys, 45 found, 45 writable, 0 configurable
as that closed sealed 45 keys, 45 found, 45 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- request finish  | response end  | response close | request close 
== a client's socket: seal a Proxy that traps set, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 45 keys, 45 found, 45 writable, 0 configurable
as that closed sealed 45 keys, 45 found, 45 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- request finish  | response end  | response close | request close 
== a client's socket: preventExtensions itself, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 45 keys, 45 found, 45 writable, 45 configurable
as that closed 45 keys, 45 found, 45 writable, 45 configurable
defined anew true added false removed true absent removed true absent found false
-- request finish  | response end  | response close | request close 
== a client's socket: preventExtensions a Proxy, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 45 keys, 45 found, 45 writable, 45 configurable
as that closed 45 keys, 45 found, 45 writable, 45 configurable
defined anew true added false removed true absent removed true absent found false
-- request finish  | response end  | response close | request close 
== a client's socket: preventExtensions a Proxy, then used as that
traps while closing: 0 of them for a key that is not listed: 0
itself closed 45 keys, 45 found, 45 writable, 45 configurable
as that closed 45 keys, 45 found, 45 writable, 45 configurable
defined anew true added false removed true absent removed true absent found false
-- request finish  | response end  | response close | request close 
== a client's socket: preventExtensions a Proxy of a Proxy, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 45 keys, 45 found, 45 writable, 45 configurable
as that closed 45 keys, 45 found, 45 writable, 45 configurable
defined anew true added false removed true absent removed true absent found false
-- request finish  | response end  | response close | request close 
== a client's socket: preventExtensions a Proxy with every trap, then used itself
traps while closing: 1 of them for a key that is not listed: 0
itself closed 45 keys, 45 found, 45 writable, 45 configurable
as that closed 45 keys, 45 found, 45 writable, 45 configurable
defined anew true added false removed true absent removed true absent found false
-- request finish  | response end  | response close | request close 
== a client's socket: preventExtensions a Proxy with every trap, then used as that
traps while closing: 1 of them for a key that is not listed: 0
itself closed 45 keys, 45 found, 45 writable, 45 configurable
as that closed 45 keys, 45 found, 45 writable, 45 configurable
defined anew true added false removed true absent removed true absent found false
-- request finish  | response end  | response close | request close 
== a client's socket: preventExtensions a Proxy with every trap of a Proxy with every trap, then used itself
traps while closing: 3 of them for a key that is not listed: 0
itself closed 45 keys, 45 found, 45 writable, 45 configurable
as that closed 45 keys, 45 found, 45 writable, 45 configurable
defined anew true added false removed true absent removed true absent found false
-- request finish  | response end  | response close | request close 
== a client's socket: preventExtensions a revoked Proxy, then used itself
closing threw TypeError
traps while closing: 0 of them for a key that is not listed: 0
itself open 45 keys, 45 found, 45 writable, 45 configurable
asking threw TypeError
changing threw TypeError
-- request finish  | response end  | response close | request close 
== a client's socket: preventExtensions a Proxy of a revoked Proxy, then used itself
closing threw TypeError
traps while closing: 0 of them for a key that is not listed: 0
itself open 45 keys, 45 found, 45 writable, 45 configurable
asking threw TypeError
changing threw TypeError
-- request finish  | response end  | response close | request close 
== a client's socket: preventExtensions a Proxy that traps defineProperty, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 45 keys, 45 found, 45 writable, 45 configurable
as that closed 45 keys, 45 found, 45 writable, 45 configurable
defined anew true added false removed true absent removed true absent found false
-- request finish  | response end  | response close | request close 
== a client's socket: preventExtensions a Proxy that traps deleteProperty, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 45 keys, 45 found, 45 writable, 45 configurable
as that closed 45 keys, 45 found, 45 writable, 45 configurable
defined anew true added false removed true absent removed true absent found false
-- request finish  | response end  | response close | request close 
== a client's socket: preventExtensions a Proxy that traps get, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 45 keys, 45 found, 45 writable, 45 configurable
as that closed 45 keys, 45 found, 45 writable, 45 configurable
defined anew true added false removed true absent removed true absent found false
-- request finish  | response end  | response close | request close 
== a client's socket: preventExtensions a Proxy that traps getOwnPropertyDescriptor, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 45 keys, 45 found, 45 writable, 45 configurable
as that closed 45 keys, 45 found, 45 writable, 45 configurable
defined anew true added false removed true absent removed true absent found false
-- request finish  | response end  | response close | request close 
== a client's socket: preventExtensions a Proxy that traps getPrototypeOf, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 45 keys, 45 found, 45 writable, 45 configurable
as that closed 45 keys, 45 found, 45 writable, 45 configurable
defined anew true added false removed true absent removed true absent found false
-- request finish  | response end  | response close | request close 
== a client's socket: preventExtensions a Proxy that traps has, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 45 keys, 45 found, 45 writable, 45 configurable
as that closed 45 keys, 45 found, 45 writable, 45 configurable
defined anew true added false removed true absent removed true absent found false
-- request finish  | response end  | response close | request close 
== a client's socket: preventExtensions a Proxy that traps isExtensible, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 45 keys, 45 found, 45 writable, 45 configurable
as that closed 45 keys, 45 found, 45 writable, 45 configurable
defined anew true added false removed true absent removed true absent found false
-- request finish  | response end  | response close | request close 
== a client's socket: preventExtensions a Proxy that traps ownKeys, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 45 keys, 45 found, 45 writable, 45 configurable
as that closed 45 keys, 45 found, 45 writable, 45 configurable
defined anew true added false removed true absent removed true absent found false
-- request finish  | response end  | response close | request close 
== a client's socket: preventExtensions a Proxy that traps preventExtensions, then used itself
traps while closing: 1 of them for a key that is not listed: 0
itself closed 45 keys, 45 found, 45 writable, 45 configurable
as that closed 45 keys, 45 found, 45 writable, 45 configurable
defined anew true added false removed true absent removed true absent found false
-- request finish  | response end  | response close | request close 
== a client's socket: preventExtensions a Proxy that traps set, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 45 keys, 45 found, 45 writable, 45 configurable
as that closed 45 keys, 45 found, 45 writable, 45 configurable
defined anew true added false removed true absent removed true absent found false
-- request finish  | response end  | response close | request close 
== a server: nothing itself, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself open 37 keys, 37 found, 35 writable, 37 configurable
as that open 37 keys, 37 found, 35 writable, 37 configurable
defined anew true added true removed true absent removed true absent found false
-- answered answer | server close 
== a server: seal itself, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 37 keys, 37 found, 35 writable, 0 configurable
as that closed sealed 37 keys, 37 found, 35 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- answered answer | server close 
== a server: seal a Proxy, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 37 keys, 37 found, 35 writable, 0 configurable
as that closed sealed 37 keys, 37 found, 35 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- answered answer | server close 
== a server: seal a Proxy, then used as that
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 37 keys, 37 found, 35 writable, 0 configurable
as that closed sealed 37 keys, 37 found, 35 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- answered answer | server close 
== a server: seal a Proxy of a Proxy, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 37 keys, 37 found, 35 writable, 0 configurable
as that closed sealed 37 keys, 37 found, 35 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- answered answer | server close 
== a server: seal a Proxy with every trap, then used itself
traps while closing: 39 of them for a key that is not listed: 0
itself closed sealed 37 keys, 37 found, 35 writable, 0 configurable
as that closed sealed 37 keys, 37 found, 35 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- answered answer | server close 
== a server: seal a Proxy with every trap, then used as that
traps while closing: 39 of them for a key that is not listed: 0
itself closed sealed 37 keys, 37 found, 35 writable, 0 configurable
as that closed sealed 37 keys, 37 found, 35 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- answered answer | server close 
== a server: seal a Proxy with every trap of a Proxy with every trap, then used itself
traps while closing: 192 of them for a key that is not listed: 0
itself closed sealed 37 keys, 37 found, 35 writable, 0 configurable
as that closed sealed 37 keys, 37 found, 35 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- answered answer | server close 
== a server: seal a revoked Proxy, then used itself
closing threw TypeError
traps while closing: 0 of them for a key that is not listed: 0
itself open 37 keys, 37 found, 35 writable, 37 configurable
asking threw TypeError
changing threw TypeError
-- answered answer | server close 
== a server: seal a Proxy of a revoked Proxy, then used itself
closing threw TypeError
traps while closing: 0 of them for a key that is not listed: 0
itself open 37 keys, 37 found, 35 writable, 37 configurable
asking threw TypeError
changing threw TypeError
-- answered answer | server close 
== a server: seal a Proxy that traps defineProperty, then used itself
traps while closing: 37 of them for a key that is not listed: 0
itself closed sealed 37 keys, 37 found, 35 writable, 0 configurable
as that closed sealed 37 keys, 37 found, 35 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- answered answer | server close 
== a server: seal a Proxy that traps deleteProperty, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 37 keys, 37 found, 35 writable, 0 configurable
as that closed sealed 37 keys, 37 found, 35 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- answered answer | server close 
== a server: seal a Proxy that traps get, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 37 keys, 37 found, 35 writable, 0 configurable
as that closed sealed 37 keys, 37 found, 35 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- answered answer | server close 
== a server: seal a Proxy that traps getOwnPropertyDescriptor, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 37 keys, 37 found, 35 writable, 0 configurable
as that closed sealed 37 keys, 37 found, 35 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- answered answer | server close 
== a server: seal a Proxy that traps getPrototypeOf, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 37 keys, 37 found, 35 writable, 0 configurable
as that closed sealed 37 keys, 37 found, 35 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- answered answer | server close 
== a server: seal a Proxy that traps has, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 37 keys, 37 found, 35 writable, 0 configurable
as that closed sealed 37 keys, 37 found, 35 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- answered answer | server close 
== a server: seal a Proxy that traps isExtensible, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 37 keys, 37 found, 35 writable, 0 configurable
as that closed sealed 37 keys, 37 found, 35 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- answered answer | server close 
== a server: seal a Proxy that traps ownKeys, then used itself
traps while closing: 1 of them for a key that is not listed: 0
itself closed sealed 37 keys, 37 found, 35 writable, 0 configurable
as that closed sealed 37 keys, 37 found, 35 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- answered answer | server close 
== a server: seal a Proxy that traps preventExtensions, then used itself
traps while closing: 1 of them for a key that is not listed: 0
itself closed sealed 37 keys, 37 found, 35 writable, 0 configurable
as that closed sealed 37 keys, 37 found, 35 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- answered answer | server close 
== a server: seal a Proxy that traps set, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 37 keys, 37 found, 35 writable, 0 configurable
as that closed sealed 37 keys, 37 found, 35 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- answered answer | server close 
== a server: preventExtensions itself, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 37 keys, 37 found, 35 writable, 37 configurable
as that closed 37 keys, 37 found, 35 writable, 37 configurable
defined anew true added false removed true absent removed true absent found false
-- answered answer | server close 
== a server: preventExtensions a Proxy, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 37 keys, 37 found, 35 writable, 37 configurable
as that closed 37 keys, 37 found, 35 writable, 37 configurable
defined anew true added false removed true absent removed true absent found false
-- answered answer | server close 
== a server: preventExtensions a Proxy, then used as that
traps while closing: 0 of them for a key that is not listed: 0
itself closed 37 keys, 37 found, 35 writable, 37 configurable
as that closed 37 keys, 37 found, 35 writable, 37 configurable
defined anew true added false removed true absent removed true absent found false
-- answered answer | server close 
== a server: preventExtensions a Proxy of a Proxy, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 37 keys, 37 found, 35 writable, 37 configurable
as that closed 37 keys, 37 found, 35 writable, 37 configurable
defined anew true added false removed true absent removed true absent found false
-- answered answer | server close 
== a server: preventExtensions a Proxy with every trap, then used itself
traps while closing: 1 of them for a key that is not listed: 0
itself closed 37 keys, 37 found, 35 writable, 37 configurable
as that closed 37 keys, 37 found, 35 writable, 37 configurable
defined anew true added false removed true absent removed true absent found false
-- answered answer | server close 
== a server: preventExtensions a Proxy with every trap, then used as that
traps while closing: 1 of them for a key that is not listed: 0
itself closed 37 keys, 37 found, 35 writable, 37 configurable
as that closed 37 keys, 37 found, 35 writable, 37 configurable
defined anew true added false removed true absent removed true absent found false
-- answered answer | server close 
== a server: preventExtensions a Proxy with every trap of a Proxy with every trap, then used itself
traps while closing: 3 of them for a key that is not listed: 0
itself closed 37 keys, 37 found, 35 writable, 37 configurable
as that closed 37 keys, 37 found, 35 writable, 37 configurable
defined anew true added false removed true absent removed true absent found false
-- answered answer | server close 
== a server: preventExtensions a revoked Proxy, then used itself
closing threw TypeError
traps while closing: 0 of them for a key that is not listed: 0
itself open 37 keys, 37 found, 35 writable, 37 configurable
asking threw TypeError
changing threw TypeError
-- answered answer | server close 
== a server: preventExtensions a Proxy of a revoked Proxy, then used itself
closing threw TypeError
traps while closing: 0 of them for a key that is not listed: 0
itself open 37 keys, 37 found, 35 writable, 37 configurable
asking threw TypeError
changing threw TypeError
-- answered answer | server close 
== a server: preventExtensions a Proxy that traps defineProperty, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 37 keys, 37 found, 35 writable, 37 configurable
as that closed 37 keys, 37 found, 35 writable, 37 configurable
defined anew true added false removed true absent removed true absent found false
-- answered answer | server close 
== a server: preventExtensions a Proxy that traps deleteProperty, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 37 keys, 37 found, 35 writable, 37 configurable
as that closed 37 keys, 37 found, 35 writable, 37 configurable
defined anew true added false removed true absent removed true absent found false
-- answered answer | server close 
== a server: preventExtensions a Proxy that traps get, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 37 keys, 37 found, 35 writable, 37 configurable
as that closed 37 keys, 37 found, 35 writable, 37 configurable
defined anew true added false removed true absent removed true absent found false
-- answered answer | server close 
== a server: preventExtensions a Proxy that traps getOwnPropertyDescriptor, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 37 keys, 37 found, 35 writable, 37 configurable
as that closed 37 keys, 37 found, 35 writable, 37 configurable
defined anew true added false removed true absent removed true absent found false
-- answered answer | server close 
== a server: preventExtensions a Proxy that traps getPrototypeOf, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 37 keys, 37 found, 35 writable, 37 configurable
as that closed 37 keys, 37 found, 35 writable, 37 configurable
defined anew true added false removed true absent removed true absent found false
-- answered answer | server close 
== a server: preventExtensions a Proxy that traps has, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 37 keys, 37 found, 35 writable, 37 configurable
as that closed 37 keys, 37 found, 35 writable, 37 configurable
defined anew true added false removed true absent removed true absent found false
-- answered answer | server close 
== a server: preventExtensions a Proxy that traps isExtensible, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 37 keys, 37 found, 35 writable, 37 configurable
as that closed 37 keys, 37 found, 35 writable, 37 configurable
defined anew true added false removed true absent removed true absent found false
-- answered answer | server close 
== a server: preventExtensions a Proxy that traps ownKeys, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 37 keys, 37 found, 35 writable, 37 configurable
as that closed 37 keys, 37 found, 35 writable, 37 configurable
defined anew true added false removed true absent removed true absent found false
-- answered answer | server close 
== a server: preventExtensions a Proxy that traps preventExtensions, then used itself
traps while closing: 1 of them for a key that is not listed: 0
itself closed 37 keys, 37 found, 35 writable, 37 configurable
as that closed 37 keys, 37 found, 35 writable, 37 configurable
defined anew true added false removed true absent removed true absent found false
-- answered answer | server close 
== a server: preventExtensions a Proxy that traps set, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 37 keys, 37 found, 35 writable, 37 configurable
as that closed 37 keys, 37 found, 35 writable, 37 configurable
defined anew true added false removed true absent removed true absent found false
-- answered answer | server close 
== a readable stream: nothing itself, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself open 8 keys, 8 found, 8 writable, 8 configurable
as that open 8 keys, 8 found, 8 writable, 8 configurable
defined anew true added true removed true absent removed true absent found false
-- stream end  | stream close 
== a readable stream: freeze itself, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed frozen 8 keys, 8 found, 0 writable, 0 configurable
as that closed sealed frozen 8 keys, 8 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream end  | nobody caught TypeError in endReadableNT
== a readable stream: freeze a Proxy, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed frozen 8 keys, 8 found, 0 writable, 0 configurable
as that closed sealed frozen 8 keys, 8 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream end  | nobody caught TypeError in endReadableNT
== a readable stream: freeze a Proxy, then used as that
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed frozen 8 keys, 8 found, 0 writable, 0 configurable
as that closed sealed frozen 8 keys, 8 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream end  | nobody caught TypeError in endReadableNT
== a readable stream: freeze a Proxy of a Proxy, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed frozen 8 keys, 8 found, 0 writable, 0 configurable
as that closed sealed frozen 8 keys, 8 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream end  | nobody caught TypeError in endReadableNT
== a readable stream: freeze a Proxy with every trap, then used itself
traps while closing: 18 of them for a key that is not listed: 0
itself closed sealed frozen 8 keys, 8 found, 0 writable, 0 configurable
as that closed sealed frozen 8 keys, 8 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream end  | nobody caught TypeError in endReadableNT
== a readable stream: freeze a Proxy with every trap, then used as that
traps while closing: 18 of them for a key that is not listed: 0
itself closed sealed frozen 8 keys, 8 found, 0 writable, 0 configurable
as that closed sealed frozen 8 keys, 8 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream end  | nobody caught TypeError in endReadableNT
== a readable stream: freeze a Proxy with every trap of a Proxy with every trap, then used itself
traps while closing: 79 of them for a key that is not listed: 0
itself closed sealed frozen 8 keys, 8 found, 0 writable, 0 configurable
as that closed sealed frozen 8 keys, 8 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream end  | nobody caught TypeError in endReadableNT
== a readable stream: freeze a revoked Proxy, then used itself
closing threw TypeError
traps while closing: 0 of them for a key that is not listed: 0
itself open 8 keys, 8 found, 8 writable, 8 configurable
asking threw TypeError
changing threw TypeError
-- stream end  | stream close 
== a readable stream: freeze a Proxy of a revoked Proxy, then used itself
closing threw TypeError
traps while closing: 0 of them for a key that is not listed: 0
itself open 8 keys, 8 found, 8 writable, 8 configurable
asking threw TypeError
changing threw TypeError
-- stream end  | stream close 
== a readable stream: freeze a Proxy that traps defineProperty, then used itself
traps while closing: 8 of them for a key that is not listed: 0
itself closed sealed frozen 8 keys, 8 found, 0 writable, 0 configurable
as that closed sealed frozen 8 keys, 8 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream end  | nobody caught TypeError in endReadableNT
== a readable stream: freeze a Proxy that traps deleteProperty, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed frozen 8 keys, 8 found, 0 writable, 0 configurable
as that closed sealed frozen 8 keys, 8 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream end  | nobody caught TypeError in endReadableNT
== a readable stream: freeze a Proxy that traps get, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed frozen 8 keys, 8 found, 0 writable, 0 configurable
as that closed sealed frozen 8 keys, 8 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream end  | nobody caught TypeError in endReadableNT
== a readable stream: freeze a Proxy that traps getOwnPropertyDescriptor, then used itself
traps while closing: 8 of them for a key that is not listed: 0
itself closed sealed frozen 8 keys, 8 found, 0 writable, 0 configurable
as that closed sealed frozen 8 keys, 8 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream end  | nobody caught TypeError in endReadableNT
== a readable stream: freeze a Proxy that traps getPrototypeOf, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed frozen 8 keys, 8 found, 0 writable, 0 configurable
as that closed sealed frozen 8 keys, 8 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream end  | nobody caught TypeError in endReadableNT
== a readable stream: freeze a Proxy that traps has, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed frozen 8 keys, 8 found, 0 writable, 0 configurable
as that closed sealed frozen 8 keys, 8 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream end  | nobody caught TypeError in endReadableNT
== a readable stream: freeze a Proxy that traps isExtensible, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed frozen 8 keys, 8 found, 0 writable, 0 configurable
as that closed sealed frozen 8 keys, 8 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream end  | nobody caught TypeError in endReadableNT
== a readable stream: freeze a Proxy that traps ownKeys, then used itself
traps while closing: 1 of them for a key that is not listed: 0
itself closed sealed frozen 8 keys, 8 found, 0 writable, 0 configurable
as that closed sealed frozen 8 keys, 8 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream end  | nobody caught TypeError in endReadableNT
== a readable stream: freeze a Proxy that traps preventExtensions, then used itself
traps while closing: 1 of them for a key that is not listed: 0
itself closed sealed frozen 8 keys, 8 found, 0 writable, 0 configurable
as that closed sealed frozen 8 keys, 8 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream end  | nobody caught TypeError in endReadableNT
== a readable stream: freeze a Proxy that traps set, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed frozen 8 keys, 8 found, 0 writable, 0 configurable
as that closed sealed frozen 8 keys, 8 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream end  | nobody caught TypeError in endReadableNT
== a readable stream: seal itself, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 8 keys, 8 found, 8 writable, 0 configurable
as that closed sealed 8 keys, 8 found, 8 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream end  | nobody caught TypeError in endReadableNT
== a readable stream: seal a Proxy, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 8 keys, 8 found, 8 writable, 0 configurable
as that closed sealed 8 keys, 8 found, 8 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream end  | nobody caught TypeError in endReadableNT
== a readable stream: seal a Proxy, then used as that
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 8 keys, 8 found, 8 writable, 0 configurable
as that closed sealed 8 keys, 8 found, 8 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream end  | nobody caught TypeError in endReadableNT
== a readable stream: seal a Proxy of a Proxy, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 8 keys, 8 found, 8 writable, 0 configurable
as that closed sealed 8 keys, 8 found, 8 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream end  | nobody caught TypeError in endReadableNT
== a readable stream: seal a Proxy with every trap, then used itself
traps while closing: 10 of them for a key that is not listed: 0
itself closed sealed 8 keys, 8 found, 8 writable, 0 configurable
as that closed sealed 8 keys, 8 found, 8 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream end  | nobody caught TypeError in endReadableNT
== a readable stream: seal a Proxy with every trap, then used as that
traps while closing: 10 of them for a key that is not listed: 0
itself closed sealed 8 keys, 8 found, 8 writable, 0 configurable
as that closed sealed 8 keys, 8 found, 8 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream end  | nobody caught TypeError in endReadableNT
== a readable stream: seal a Proxy with every trap of a Proxy with every trap, then used itself
traps while closing: 47 of them for a key that is not listed: 0
itself closed sealed 8 keys, 8 found, 8 writable, 0 configurable
as that closed sealed 8 keys, 8 found, 8 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream end  | nobody caught TypeError in endReadableNT
== a readable stream: seal a revoked Proxy, then used itself
closing threw TypeError
traps while closing: 0 of them for a key that is not listed: 0
itself open 8 keys, 8 found, 8 writable, 8 configurable
asking threw TypeError
changing threw TypeError
-- stream end  | stream close 
== a readable stream: seal a Proxy of a revoked Proxy, then used itself
closing threw TypeError
traps while closing: 0 of them for a key that is not listed: 0
itself open 8 keys, 8 found, 8 writable, 8 configurable
asking threw TypeError
changing threw TypeError
-- stream end  | stream close 
== a readable stream: seal a Proxy that traps defineProperty, then used itself
traps while closing: 8 of them for a key that is not listed: 0
itself closed sealed 8 keys, 8 found, 8 writable, 0 configurable
as that closed sealed 8 keys, 8 found, 8 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream end  | nobody caught TypeError in endReadableNT
== a readable stream: seal a Proxy that traps deleteProperty, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 8 keys, 8 found, 8 writable, 0 configurable
as that closed sealed 8 keys, 8 found, 8 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream end  | nobody caught TypeError in endReadableNT
== a readable stream: seal a Proxy that traps get, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 8 keys, 8 found, 8 writable, 0 configurable
as that closed sealed 8 keys, 8 found, 8 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream end  | nobody caught TypeError in endReadableNT
== a readable stream: seal a Proxy that traps getOwnPropertyDescriptor, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 8 keys, 8 found, 8 writable, 0 configurable
as that closed sealed 8 keys, 8 found, 8 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream end  | nobody caught TypeError in endReadableNT
== a readable stream: seal a Proxy that traps getPrototypeOf, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 8 keys, 8 found, 8 writable, 0 configurable
as that closed sealed 8 keys, 8 found, 8 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream end  | nobody caught TypeError in endReadableNT
== a readable stream: seal a Proxy that traps has, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 8 keys, 8 found, 8 writable, 0 configurable
as that closed sealed 8 keys, 8 found, 8 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream end  | nobody caught TypeError in endReadableNT
== a readable stream: seal a Proxy that traps isExtensible, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 8 keys, 8 found, 8 writable, 0 configurable
as that closed sealed 8 keys, 8 found, 8 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream end  | nobody caught TypeError in endReadableNT
== a readable stream: seal a Proxy that traps ownKeys, then used itself
traps while closing: 1 of them for a key that is not listed: 0
itself closed sealed 8 keys, 8 found, 8 writable, 0 configurable
as that closed sealed 8 keys, 8 found, 8 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream end  | nobody caught TypeError in endReadableNT
== a readable stream: seal a Proxy that traps preventExtensions, then used itself
traps while closing: 1 of them for a key that is not listed: 0
itself closed sealed 8 keys, 8 found, 8 writable, 0 configurable
as that closed sealed 8 keys, 8 found, 8 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream end  | nobody caught TypeError in endReadableNT
== a readable stream: seal a Proxy that traps set, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 8 keys, 8 found, 8 writable, 0 configurable
as that closed sealed 8 keys, 8 found, 8 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream end  | nobody caught TypeError in endReadableNT
== a readable stream: preventExtensions itself, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 8 keys, 8 found, 8 writable, 8 configurable
as that closed 8 keys, 8 found, 8 writable, 8 configurable
defined anew true added false removed true absent removed true absent found false
-- stream end  | nobody caught TypeError in endReadableNT
== a readable stream: preventExtensions a Proxy, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 8 keys, 8 found, 8 writable, 8 configurable
as that closed 8 keys, 8 found, 8 writable, 8 configurable
defined anew true added false removed true absent removed true absent found false
-- stream end  | nobody caught TypeError in endReadableNT
== a readable stream: preventExtensions a Proxy, then used as that
traps while closing: 0 of them for a key that is not listed: 0
itself closed 8 keys, 8 found, 8 writable, 8 configurable
as that closed 8 keys, 8 found, 8 writable, 8 configurable
defined anew true added false removed true absent removed true absent found false
-- stream end  | nobody caught TypeError in endReadableNT
== a readable stream: preventExtensions a Proxy of a Proxy, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 8 keys, 8 found, 8 writable, 8 configurable
as that closed 8 keys, 8 found, 8 writable, 8 configurable
defined anew true added false removed true absent removed true absent found false
-- stream end  | nobody caught TypeError in endReadableNT
== a readable stream: preventExtensions a Proxy with every trap, then used itself
traps while closing: 1 of them for a key that is not listed: 0
itself closed 8 keys, 8 found, 8 writable, 8 configurable
as that closed 8 keys, 8 found, 8 writable, 8 configurable
defined anew true added false removed true absent removed true absent found false
-- stream end  | nobody caught TypeError in endReadableNT
== a readable stream: preventExtensions a Proxy with every trap, then used as that
traps while closing: 1 of them for a key that is not listed: 0
itself closed 8 keys, 8 found, 8 writable, 8 configurable
as that closed 8 keys, 8 found, 8 writable, 8 configurable
defined anew true added false removed true absent removed true absent found false
-- stream end  | nobody caught TypeError in endReadableNT
== a readable stream: preventExtensions a Proxy with every trap of a Proxy with every trap, then used itself
traps while closing: 3 of them for a key that is not listed: 0
itself closed 8 keys, 8 found, 8 writable, 8 configurable
as that closed 8 keys, 8 found, 8 writable, 8 configurable
defined anew true added false removed true absent removed true absent found false
-- stream end  | nobody caught TypeError in endReadableNT
== a readable stream: preventExtensions a revoked Proxy, then used itself
closing threw TypeError
traps while closing: 0 of them for a key that is not listed: 0
itself open 8 keys, 8 found, 8 writable, 8 configurable
asking threw TypeError
changing threw TypeError
-- stream end  | stream close 
== a readable stream: preventExtensions a Proxy of a revoked Proxy, then used itself
closing threw TypeError
traps while closing: 0 of them for a key that is not listed: 0
itself open 8 keys, 8 found, 8 writable, 8 configurable
asking threw TypeError
changing threw TypeError
-- stream end  | stream close 
== a readable stream: preventExtensions a Proxy that traps defineProperty, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 8 keys, 8 found, 8 writable, 8 configurable
as that closed 8 keys, 8 found, 8 writable, 8 configurable
defined anew true added false removed true absent removed true absent found false
-- stream end  | nobody caught TypeError in endReadableNT
== a readable stream: preventExtensions a Proxy that traps deleteProperty, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 8 keys, 8 found, 8 writable, 8 configurable
as that closed 8 keys, 8 found, 8 writable, 8 configurable
defined anew true added false removed true absent removed true absent found false
-- stream end  | nobody caught TypeError in endReadableNT
== a readable stream: preventExtensions a Proxy that traps get, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 8 keys, 8 found, 8 writable, 8 configurable
as that closed 8 keys, 8 found, 8 writable, 8 configurable
defined anew true added false removed true absent removed true absent found false
-- stream end  | nobody caught TypeError in endReadableNT
== a readable stream: preventExtensions a Proxy that traps getOwnPropertyDescriptor, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 8 keys, 8 found, 8 writable, 8 configurable
as that closed 8 keys, 8 found, 8 writable, 8 configurable
defined anew true added false removed true absent removed true absent found false
-- stream end  | nobody caught TypeError in endReadableNT
== a readable stream: preventExtensions a Proxy that traps getPrototypeOf, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 8 keys, 8 found, 8 writable, 8 configurable
as that closed 8 keys, 8 found, 8 writable, 8 configurable
defined anew true added false removed true absent removed true absent found false
-- stream end  | nobody caught TypeError in endReadableNT
== a readable stream: preventExtensions a Proxy that traps has, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 8 keys, 8 found, 8 writable, 8 configurable
as that closed 8 keys, 8 found, 8 writable, 8 configurable
defined anew true added false removed true absent removed true absent found false
-- stream end  | nobody caught TypeError in endReadableNT
== a readable stream: preventExtensions a Proxy that traps isExtensible, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 8 keys, 8 found, 8 writable, 8 configurable
as that closed 8 keys, 8 found, 8 writable, 8 configurable
defined anew true added false removed true absent removed true absent found false
-- stream end  | nobody caught TypeError in endReadableNT
== a readable stream: preventExtensions a Proxy that traps ownKeys, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 8 keys, 8 found, 8 writable, 8 configurable
as that closed 8 keys, 8 found, 8 writable, 8 configurable
defined anew true added false removed true absent removed true absent found false
-- stream end  | nobody caught TypeError in endReadableNT
== a readable stream: preventExtensions a Proxy that traps preventExtensions, then used itself
traps while closing: 1 of them for a key that is not listed: 0
itself closed 8 keys, 8 found, 8 writable, 8 configurable
as that closed 8 keys, 8 found, 8 writable, 8 configurable
defined anew true added false removed true absent removed true absent found false
-- stream end  | nobody caught TypeError in endReadableNT
== a readable stream: preventExtensions a Proxy that traps set, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 8 keys, 8 found, 8 writable, 8 configurable
as that closed 8 keys, 8 found, 8 writable, 8 configurable
defined anew true added false removed true absent removed true absent found false
-- stream end  | nobody caught TypeError in endReadableNT
== a stream that passes through: nothing itself, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself open 9 keys, 9 found, 9 writable, 9 configurable
as that open 9 keys, 9 found, 9 writable, 9 configurable
defined anew true added true removed true absent removed true absent found false
-- stream finish  | stream end  | stream close 
== a stream that passes through: freeze itself, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed frozen 9 keys, 9 found, 0 writable, 0 configurable
as that closed sealed frozen 9 keys, 9 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream end  | nobody caught TypeError in endReadableNT
== a stream that passes through: freeze a Proxy, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed frozen 9 keys, 9 found, 0 writable, 0 configurable
as that closed sealed frozen 9 keys, 9 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream end  | nobody caught TypeError in endReadableNT
== a stream that passes through: freeze a Proxy, then used as that
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed frozen 9 keys, 9 found, 0 writable, 0 configurable
as that closed sealed frozen 9 keys, 9 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream end  | nobody caught TypeError in endReadableNT
== a stream that passes through: freeze a Proxy of a Proxy, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed frozen 9 keys, 9 found, 0 writable, 0 configurable
as that closed sealed frozen 9 keys, 9 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream end  | nobody caught TypeError in endReadableNT
== a stream that passes through: freeze a Proxy with every trap, then used itself
traps while closing: 20 of them for a key that is not listed: 0
itself closed sealed frozen 9 keys, 9 found, 0 writable, 0 configurable
as that closed sealed frozen 9 keys, 9 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream end  | nobody caught TypeError in endReadableNT
== a stream that passes through: freeze a Proxy with every trap, then used as that
traps while closing: 20 of them for a key that is not listed: 0
itself closed sealed frozen 9 keys, 9 found, 0 writable, 0 configurable
as that closed sealed frozen 9 keys, 9 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream end  | nobody caught TypeError in endReadableNT
== a stream that passes through: freeze a Proxy with every trap of a Proxy with every trap, then used itself
traps while closing: 88 of them for a key that is not listed: 0
itself closed sealed frozen 9 keys, 9 found, 0 writable, 0 configurable
as that closed sealed frozen 9 keys, 9 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream end  | nobody caught TypeError in endReadableNT
== a stream that passes through: freeze a revoked Proxy, then used itself
closing threw TypeError
traps while closing: 0 of them for a key that is not listed: 0
itself open 9 keys, 9 found, 9 writable, 9 configurable
asking threw TypeError
changing threw TypeError
-- stream finish  | stream end  | stream close 
== a stream that passes through: freeze a Proxy of a revoked Proxy, then used itself
closing threw TypeError
traps while closing: 0 of them for a key that is not listed: 0
itself open 9 keys, 9 found, 9 writable, 9 configurable
asking threw TypeError
changing threw TypeError
-- stream finish  | stream end  | stream close 
== a stream that passes through: freeze a Proxy that traps defineProperty, then used itself
traps while closing: 9 of them for a key that is not listed: 0
itself closed sealed frozen 9 keys, 9 found, 0 writable, 0 configurable
as that closed sealed frozen 9 keys, 9 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream end  | nobody caught TypeError in endReadableNT
== a stream that passes through: freeze a Proxy that traps deleteProperty, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed frozen 9 keys, 9 found, 0 writable, 0 configurable
as that closed sealed frozen 9 keys, 9 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream end  | nobody caught TypeError in endReadableNT
== a stream that passes through: freeze a Proxy that traps get, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed frozen 9 keys, 9 found, 0 writable, 0 configurable
as that closed sealed frozen 9 keys, 9 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream end  | nobody caught TypeError in endReadableNT
== a stream that passes through: freeze a Proxy that traps getOwnPropertyDescriptor, then used itself
traps while closing: 9 of them for a key that is not listed: 0
itself closed sealed frozen 9 keys, 9 found, 0 writable, 0 configurable
as that closed sealed frozen 9 keys, 9 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream end  | nobody caught TypeError in endReadableNT
== a stream that passes through: freeze a Proxy that traps getPrototypeOf, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed frozen 9 keys, 9 found, 0 writable, 0 configurable
as that closed sealed frozen 9 keys, 9 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream end  | nobody caught TypeError in endReadableNT
== a stream that passes through: freeze a Proxy that traps has, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed frozen 9 keys, 9 found, 0 writable, 0 configurable
as that closed sealed frozen 9 keys, 9 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream end  | nobody caught TypeError in endReadableNT
== a stream that passes through: freeze a Proxy that traps isExtensible, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed frozen 9 keys, 9 found, 0 writable, 0 configurable
as that closed sealed frozen 9 keys, 9 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream end  | nobody caught TypeError in endReadableNT
== a stream that passes through: freeze a Proxy that traps ownKeys, then used itself
traps while closing: 1 of them for a key that is not listed: 0
itself closed sealed frozen 9 keys, 9 found, 0 writable, 0 configurable
as that closed sealed frozen 9 keys, 9 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream end  | nobody caught TypeError in endReadableNT
== a stream that passes through: freeze a Proxy that traps preventExtensions, then used itself
traps while closing: 1 of them for a key that is not listed: 0
itself closed sealed frozen 9 keys, 9 found, 0 writable, 0 configurable
as that closed sealed frozen 9 keys, 9 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream end  | nobody caught TypeError in endReadableNT
== a stream that passes through: freeze a Proxy that traps set, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed frozen 9 keys, 9 found, 0 writable, 0 configurable
as that closed sealed frozen 9 keys, 9 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream end  | nobody caught TypeError in endReadableNT
== a stream that passes through: seal itself, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 9 keys, 9 found, 9 writable, 0 configurable
as that closed sealed 9 keys, 9 found, 9 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream end  | nobody caught TypeError in endReadableNT
== a stream that passes through: seal a Proxy, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 9 keys, 9 found, 9 writable, 0 configurable
as that closed sealed 9 keys, 9 found, 9 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream end  | nobody caught TypeError in endReadableNT
== a stream that passes through: seal a Proxy, then used as that
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 9 keys, 9 found, 9 writable, 0 configurable
as that closed sealed 9 keys, 9 found, 9 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream end  | nobody caught TypeError in endReadableNT
== a stream that passes through: seal a Proxy of a Proxy, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 9 keys, 9 found, 9 writable, 0 configurable
as that closed sealed 9 keys, 9 found, 9 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream end  | nobody caught TypeError in endReadableNT
== a stream that passes through: seal a Proxy with every trap, then used itself
traps while closing: 11 of them for a key that is not listed: 0
itself closed sealed 9 keys, 9 found, 9 writable, 0 configurable
as that closed sealed 9 keys, 9 found, 9 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream end  | nobody caught TypeError in endReadableNT
== a stream that passes through: seal a Proxy with every trap, then used as that
traps while closing: 11 of them for a key that is not listed: 0
itself closed sealed 9 keys, 9 found, 9 writable, 0 configurable
as that closed sealed 9 keys, 9 found, 9 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream end  | nobody caught TypeError in endReadableNT
== a stream that passes through: seal a Proxy with every trap of a Proxy with every trap, then used itself
traps while closing: 52 of them for a key that is not listed: 0
itself closed sealed 9 keys, 9 found, 9 writable, 0 configurable
as that closed sealed 9 keys, 9 found, 9 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream end  | nobody caught TypeError in endReadableNT
== a stream that passes through: seal a revoked Proxy, then used itself
closing threw TypeError
traps while closing: 0 of them for a key that is not listed: 0
itself open 9 keys, 9 found, 9 writable, 9 configurable
asking threw TypeError
changing threw TypeError
-- stream finish  | stream end  | stream close 
== a stream that passes through: seal a Proxy of a revoked Proxy, then used itself
closing threw TypeError
traps while closing: 0 of them for a key that is not listed: 0
itself open 9 keys, 9 found, 9 writable, 9 configurable
asking threw TypeError
changing threw TypeError
-- stream finish  | stream end  | stream close 
== a stream that passes through: seal a Proxy that traps defineProperty, then used itself
traps while closing: 9 of them for a key that is not listed: 0
itself closed sealed 9 keys, 9 found, 9 writable, 0 configurable
as that closed sealed 9 keys, 9 found, 9 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream end  | nobody caught TypeError in endReadableNT
== a stream that passes through: seal a Proxy that traps deleteProperty, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 9 keys, 9 found, 9 writable, 0 configurable
as that closed sealed 9 keys, 9 found, 9 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream end  | nobody caught TypeError in endReadableNT
== a stream that passes through: seal a Proxy that traps get, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 9 keys, 9 found, 9 writable, 0 configurable
as that closed sealed 9 keys, 9 found, 9 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream end  | nobody caught TypeError in endReadableNT
== a stream that passes through: seal a Proxy that traps getOwnPropertyDescriptor, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 9 keys, 9 found, 9 writable, 0 configurable
as that closed sealed 9 keys, 9 found, 9 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream end  | nobody caught TypeError in endReadableNT
== a stream that passes through: seal a Proxy that traps getPrototypeOf, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 9 keys, 9 found, 9 writable, 0 configurable
as that closed sealed 9 keys, 9 found, 9 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream end  | nobody caught TypeError in endReadableNT
== a stream that passes through: seal a Proxy that traps has, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 9 keys, 9 found, 9 writable, 0 configurable
as that closed sealed 9 keys, 9 found, 9 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream end  | nobody caught TypeError in endReadableNT
== a stream that passes through: seal a Proxy that traps isExtensible, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 9 keys, 9 found, 9 writable, 0 configurable
as that closed sealed 9 keys, 9 found, 9 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream end  | nobody caught TypeError in endReadableNT
== a stream that passes through: seal a Proxy that traps ownKeys, then used itself
traps while closing: 1 of them for a key that is not listed: 0
itself closed sealed 9 keys, 9 found, 9 writable, 0 configurable
as that closed sealed 9 keys, 9 found, 9 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream end  | nobody caught TypeError in endReadableNT
== a stream that passes through: seal a Proxy that traps preventExtensions, then used itself
traps while closing: 1 of them for a key that is not listed: 0
itself closed sealed 9 keys, 9 found, 9 writable, 0 configurable
as that closed sealed 9 keys, 9 found, 9 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream end  | nobody caught TypeError in endReadableNT
== a stream that passes through: seal a Proxy that traps set, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 9 keys, 9 found, 9 writable, 0 configurable
as that closed sealed 9 keys, 9 found, 9 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream end  | nobody caught TypeError in endReadableNT
== a stream that passes through: preventExtensions itself, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 9 keys, 9 found, 9 writable, 9 configurable
as that closed 9 keys, 9 found, 9 writable, 9 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream end  | nobody caught TypeError in endReadableNT
== a stream that passes through: preventExtensions a Proxy, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 9 keys, 9 found, 9 writable, 9 configurable
as that closed 9 keys, 9 found, 9 writable, 9 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream end  | nobody caught TypeError in endReadableNT
== a stream that passes through: preventExtensions a Proxy, then used as that
traps while closing: 0 of them for a key that is not listed: 0
itself closed 9 keys, 9 found, 9 writable, 9 configurable
as that closed 9 keys, 9 found, 9 writable, 9 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream end  | nobody caught TypeError in endReadableNT
== a stream that passes through: preventExtensions a Proxy of a Proxy, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 9 keys, 9 found, 9 writable, 9 configurable
as that closed 9 keys, 9 found, 9 writable, 9 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream end  | nobody caught TypeError in endReadableNT
== a stream that passes through: preventExtensions a Proxy with every trap, then used itself
traps while closing: 1 of them for a key that is not listed: 0
itself closed 9 keys, 9 found, 9 writable, 9 configurable
as that closed 9 keys, 9 found, 9 writable, 9 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream end  | nobody caught TypeError in endReadableNT
== a stream that passes through: preventExtensions a Proxy with every trap, then used as that
traps while closing: 1 of them for a key that is not listed: 0
itself closed 9 keys, 9 found, 9 writable, 9 configurable
as that closed 9 keys, 9 found, 9 writable, 9 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream end  | nobody caught TypeError in endReadableNT
== a stream that passes through: preventExtensions a Proxy with every trap of a Proxy with every trap, then used itself
traps while closing: 3 of them for a key that is not listed: 0
itself closed 9 keys, 9 found, 9 writable, 9 configurable
as that closed 9 keys, 9 found, 9 writable, 9 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream end  | nobody caught TypeError in endReadableNT
== a stream that passes through: preventExtensions a revoked Proxy, then used itself
closing threw TypeError
traps while closing: 0 of them for a key that is not listed: 0
itself open 9 keys, 9 found, 9 writable, 9 configurable
asking threw TypeError
changing threw TypeError
-- stream finish  | stream end  | stream close 
== a stream that passes through: preventExtensions a Proxy of a revoked Proxy, then used itself
closing threw TypeError
traps while closing: 0 of them for a key that is not listed: 0
itself open 9 keys, 9 found, 9 writable, 9 configurable
asking threw TypeError
changing threw TypeError
-- stream finish  | stream end  | stream close 
== a stream that passes through: preventExtensions a Proxy that traps defineProperty, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 9 keys, 9 found, 9 writable, 9 configurable
as that closed 9 keys, 9 found, 9 writable, 9 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream end  | nobody caught TypeError in endReadableNT
== a stream that passes through: preventExtensions a Proxy that traps deleteProperty, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 9 keys, 9 found, 9 writable, 9 configurable
as that closed 9 keys, 9 found, 9 writable, 9 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream end  | nobody caught TypeError in endReadableNT
== a stream that passes through: preventExtensions a Proxy that traps get, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 9 keys, 9 found, 9 writable, 9 configurable
as that closed 9 keys, 9 found, 9 writable, 9 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream end  | nobody caught TypeError in endReadableNT
== a stream that passes through: preventExtensions a Proxy that traps getOwnPropertyDescriptor, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 9 keys, 9 found, 9 writable, 9 configurable
as that closed 9 keys, 9 found, 9 writable, 9 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream end  | nobody caught TypeError in endReadableNT
== a stream that passes through: preventExtensions a Proxy that traps getPrototypeOf, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 9 keys, 9 found, 9 writable, 9 configurable
as that closed 9 keys, 9 found, 9 writable, 9 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream end  | nobody caught TypeError in endReadableNT
== a stream that passes through: preventExtensions a Proxy that traps has, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 9 keys, 9 found, 9 writable, 9 configurable
as that closed 9 keys, 9 found, 9 writable, 9 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream end  | nobody caught TypeError in endReadableNT
== a stream that passes through: preventExtensions a Proxy that traps isExtensible, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 9 keys, 9 found, 9 writable, 9 configurable
as that closed 9 keys, 9 found, 9 writable, 9 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream end  | nobody caught TypeError in endReadableNT
== a stream that passes through: preventExtensions a Proxy that traps ownKeys, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 9 keys, 9 found, 9 writable, 9 configurable
as that closed 9 keys, 9 found, 9 writable, 9 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream end  | nobody caught TypeError in endReadableNT
== a stream that passes through: preventExtensions a Proxy that traps preventExtensions, then used itself
traps while closing: 1 of them for a key that is not listed: 0
itself closed 9 keys, 9 found, 9 writable, 9 configurable
as that closed 9 keys, 9 found, 9 writable, 9 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream end  | nobody caught TypeError in endReadableNT
== a stream that passes through: preventExtensions a Proxy that traps set, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 9 keys, 9 found, 9 writable, 9 configurable
as that closed 9 keys, 9 found, 9 writable, 9 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream end  | nobody caught TypeError in endReadableNT
== a duplex stream: nothing itself, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself open 10 keys, 10 found, 10 writable, 10 configurable
as that open 10 keys, 10 found, 10 writable, 10 configurable
defined anew true added true removed true absent removed true absent found false
-- stream finish  | stream end  | stream close 
== a duplex stream: freeze itself, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed frozen 10 keys, 10 found, 0 writable, 0 configurable
as that closed sealed frozen 10 keys, 10 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream end  | nobody caught TypeError in endReadableNT
== a duplex stream: freeze a Proxy, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed frozen 10 keys, 10 found, 0 writable, 0 configurable
as that closed sealed frozen 10 keys, 10 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream end  | nobody caught TypeError in endReadableNT
== a duplex stream: freeze a Proxy, then used as that
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed frozen 10 keys, 10 found, 0 writable, 0 configurable
as that closed sealed frozen 10 keys, 10 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream end  | nobody caught TypeError in endReadableNT
== a duplex stream: freeze a Proxy of a Proxy, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed frozen 10 keys, 10 found, 0 writable, 0 configurable
as that closed sealed frozen 10 keys, 10 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream end  | nobody caught TypeError in endReadableNT
== a duplex stream: freeze a Proxy with every trap, then used itself
traps while closing: 22 of them for a key that is not listed: 0
itself closed sealed frozen 10 keys, 10 found, 0 writable, 0 configurable
as that closed sealed frozen 10 keys, 10 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream end  | nobody caught TypeError in endReadableNT
== a duplex stream: freeze a Proxy with every trap, then used as that
traps while closing: 22 of them for a key that is not listed: 0
itself closed sealed frozen 10 keys, 10 found, 0 writable, 0 configurable
as that closed sealed frozen 10 keys, 10 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream end  | nobody caught TypeError in endReadableNT
== a duplex stream: freeze a Proxy with every trap of a Proxy with every trap, then used itself
traps while closing: 97 of them for a key that is not listed: 0
itself closed sealed frozen 10 keys, 10 found, 0 writable, 0 configurable
as that closed sealed frozen 10 keys, 10 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream end  | nobody caught TypeError in endReadableNT
== a duplex stream: freeze a revoked Proxy, then used itself
closing threw TypeError
traps while closing: 0 of them for a key that is not listed: 0
itself open 10 keys, 10 found, 10 writable, 10 configurable
asking threw TypeError
changing threw TypeError
-- stream finish  | stream end  | stream close 
== a duplex stream: freeze a Proxy of a revoked Proxy, then used itself
closing threw TypeError
traps while closing: 0 of them for a key that is not listed: 0
itself open 10 keys, 10 found, 10 writable, 10 configurable
asking threw TypeError
changing threw TypeError
-- stream finish  | stream end  | stream close 
== a duplex stream: freeze a Proxy that traps defineProperty, then used itself
traps while closing: 10 of them for a key that is not listed: 0
itself closed sealed frozen 10 keys, 10 found, 0 writable, 0 configurable
as that closed sealed frozen 10 keys, 10 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream end  | nobody caught TypeError in endReadableNT
== a duplex stream: freeze a Proxy that traps deleteProperty, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed frozen 10 keys, 10 found, 0 writable, 0 configurable
as that closed sealed frozen 10 keys, 10 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream end  | nobody caught TypeError in endReadableNT
== a duplex stream: freeze a Proxy that traps get, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed frozen 10 keys, 10 found, 0 writable, 0 configurable
as that closed sealed frozen 10 keys, 10 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream end  | nobody caught TypeError in endReadableNT
== a duplex stream: freeze a Proxy that traps getOwnPropertyDescriptor, then used itself
traps while closing: 10 of them for a key that is not listed: 0
itself closed sealed frozen 10 keys, 10 found, 0 writable, 0 configurable
as that closed sealed frozen 10 keys, 10 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream end  | nobody caught TypeError in endReadableNT
== a duplex stream: freeze a Proxy that traps getPrototypeOf, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed frozen 10 keys, 10 found, 0 writable, 0 configurable
as that closed sealed frozen 10 keys, 10 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream end  | nobody caught TypeError in endReadableNT
== a duplex stream: freeze a Proxy that traps has, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed frozen 10 keys, 10 found, 0 writable, 0 configurable
as that closed sealed frozen 10 keys, 10 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream end  | nobody caught TypeError in endReadableNT
== a duplex stream: freeze a Proxy that traps isExtensible, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed frozen 10 keys, 10 found, 0 writable, 0 configurable
as that closed sealed frozen 10 keys, 10 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream end  | nobody caught TypeError in endReadableNT
== a duplex stream: freeze a Proxy that traps ownKeys, then used itself
traps while closing: 1 of them for a key that is not listed: 0
itself closed sealed frozen 10 keys, 10 found, 0 writable, 0 configurable
as that closed sealed frozen 10 keys, 10 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream end  | nobody caught TypeError in endReadableNT
== a duplex stream: freeze a Proxy that traps preventExtensions, then used itself
traps while closing: 1 of them for a key that is not listed: 0
itself closed sealed frozen 10 keys, 10 found, 0 writable, 0 configurable
as that closed sealed frozen 10 keys, 10 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream end  | nobody caught TypeError in endReadableNT
== a duplex stream: freeze a Proxy that traps set, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed frozen 10 keys, 10 found, 0 writable, 0 configurable
as that closed sealed frozen 10 keys, 10 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream end  | nobody caught TypeError in endReadableNT
== a duplex stream: seal itself, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 10 keys, 10 found, 10 writable, 0 configurable
as that closed sealed 10 keys, 10 found, 10 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream end  | nobody caught TypeError in endReadableNT
== a duplex stream: seal a Proxy, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 10 keys, 10 found, 10 writable, 0 configurable
as that closed sealed 10 keys, 10 found, 10 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream end  | nobody caught TypeError in endReadableNT
== a duplex stream: seal a Proxy, then used as that
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 10 keys, 10 found, 10 writable, 0 configurable
as that closed sealed 10 keys, 10 found, 10 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream end  | nobody caught TypeError in endReadableNT
== a duplex stream: seal a Proxy of a Proxy, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 10 keys, 10 found, 10 writable, 0 configurable
as that closed sealed 10 keys, 10 found, 10 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream end  | nobody caught TypeError in endReadableNT
== a duplex stream: seal a Proxy with every trap, then used itself
traps while closing: 12 of them for a key that is not listed: 0
itself closed sealed 10 keys, 10 found, 10 writable, 0 configurable
as that closed sealed 10 keys, 10 found, 10 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream end  | nobody caught TypeError in endReadableNT
== a duplex stream: seal a Proxy with every trap, then used as that
traps while closing: 12 of them for a key that is not listed: 0
itself closed sealed 10 keys, 10 found, 10 writable, 0 configurable
as that closed sealed 10 keys, 10 found, 10 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream end  | nobody caught TypeError in endReadableNT
== a duplex stream: seal a Proxy with every trap of a Proxy with every trap, then used itself
traps while closing: 57 of them for a key that is not listed: 0
itself closed sealed 10 keys, 10 found, 10 writable, 0 configurable
as that closed sealed 10 keys, 10 found, 10 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream end  | nobody caught TypeError in endReadableNT
== a duplex stream: seal a revoked Proxy, then used itself
closing threw TypeError
traps while closing: 0 of them for a key that is not listed: 0
itself open 10 keys, 10 found, 10 writable, 10 configurable
asking threw TypeError
changing threw TypeError
-- stream finish  | stream end  | stream close 
== a duplex stream: seal a Proxy of a revoked Proxy, then used itself
closing threw TypeError
traps while closing: 0 of them for a key that is not listed: 0
itself open 10 keys, 10 found, 10 writable, 10 configurable
asking threw TypeError
changing threw TypeError
-- stream finish  | stream end  | stream close 
== a duplex stream: seal a Proxy that traps defineProperty, then used itself
traps while closing: 10 of them for a key that is not listed: 0
itself closed sealed 10 keys, 10 found, 10 writable, 0 configurable
as that closed sealed 10 keys, 10 found, 10 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream end  | nobody caught TypeError in endReadableNT
== a duplex stream: seal a Proxy that traps deleteProperty, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 10 keys, 10 found, 10 writable, 0 configurable
as that closed sealed 10 keys, 10 found, 10 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream end  | nobody caught TypeError in endReadableNT
== a duplex stream: seal a Proxy that traps get, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 10 keys, 10 found, 10 writable, 0 configurable
as that closed sealed 10 keys, 10 found, 10 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream end  | nobody caught TypeError in endReadableNT
== a duplex stream: seal a Proxy that traps getOwnPropertyDescriptor, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 10 keys, 10 found, 10 writable, 0 configurable
as that closed sealed 10 keys, 10 found, 10 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream end  | nobody caught TypeError in endReadableNT
== a duplex stream: seal a Proxy that traps getPrototypeOf, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 10 keys, 10 found, 10 writable, 0 configurable
as that closed sealed 10 keys, 10 found, 10 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream end  | nobody caught TypeError in endReadableNT
== a duplex stream: seal a Proxy that traps has, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 10 keys, 10 found, 10 writable, 0 configurable
as that closed sealed 10 keys, 10 found, 10 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream end  | nobody caught TypeError in endReadableNT
== a duplex stream: seal a Proxy that traps isExtensible, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 10 keys, 10 found, 10 writable, 0 configurable
as that closed sealed 10 keys, 10 found, 10 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream end  | nobody caught TypeError in endReadableNT
== a duplex stream: seal a Proxy that traps ownKeys, then used itself
traps while closing: 1 of them for a key that is not listed: 0
itself closed sealed 10 keys, 10 found, 10 writable, 0 configurable
as that closed sealed 10 keys, 10 found, 10 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream end  | nobody caught TypeError in endReadableNT
== a duplex stream: seal a Proxy that traps preventExtensions, then used itself
traps while closing: 1 of them for a key that is not listed: 0
itself closed sealed 10 keys, 10 found, 10 writable, 0 configurable
as that closed sealed 10 keys, 10 found, 10 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream end  | nobody caught TypeError in endReadableNT
== a duplex stream: seal a Proxy that traps set, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 10 keys, 10 found, 10 writable, 0 configurable
as that closed sealed 10 keys, 10 found, 10 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream end  | nobody caught TypeError in endReadableNT
== a duplex stream: preventExtensions itself, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 10 keys, 10 found, 10 writable, 10 configurable
as that closed 10 keys, 10 found, 10 writable, 10 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream end  | nobody caught TypeError in endReadableNT
== a duplex stream: preventExtensions a Proxy, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 10 keys, 10 found, 10 writable, 10 configurable
as that closed 10 keys, 10 found, 10 writable, 10 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream end  | nobody caught TypeError in endReadableNT
== a duplex stream: preventExtensions a Proxy, then used as that
traps while closing: 0 of them for a key that is not listed: 0
itself closed 10 keys, 10 found, 10 writable, 10 configurable
as that closed 10 keys, 10 found, 10 writable, 10 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream end  | nobody caught TypeError in endReadableNT
== a duplex stream: preventExtensions a Proxy of a Proxy, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 10 keys, 10 found, 10 writable, 10 configurable
as that closed 10 keys, 10 found, 10 writable, 10 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream end  | nobody caught TypeError in endReadableNT
== a duplex stream: preventExtensions a Proxy with every trap, then used itself
traps while closing: 1 of them for a key that is not listed: 0
itself closed 10 keys, 10 found, 10 writable, 10 configurable
as that closed 10 keys, 10 found, 10 writable, 10 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream end  | nobody caught TypeError in endReadableNT
== a duplex stream: preventExtensions a Proxy with every trap, then used as that
traps while closing: 1 of them for a key that is not listed: 0
itself closed 10 keys, 10 found, 10 writable, 10 configurable
as that closed 10 keys, 10 found, 10 writable, 10 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream end  | nobody caught TypeError in endReadableNT
== a duplex stream: preventExtensions a Proxy with every trap of a Proxy with every trap, then used itself
traps while closing: 3 of them for a key that is not listed: 0
itself closed 10 keys, 10 found, 10 writable, 10 configurable
as that closed 10 keys, 10 found, 10 writable, 10 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream end  | nobody caught TypeError in endReadableNT
== a duplex stream: preventExtensions a revoked Proxy, then used itself
closing threw TypeError
traps while closing: 0 of them for a key that is not listed: 0
itself open 10 keys, 10 found, 10 writable, 10 configurable
asking threw TypeError
changing threw TypeError
-- stream finish  | stream end  | stream close 
== a duplex stream: preventExtensions a Proxy of a revoked Proxy, then used itself
closing threw TypeError
traps while closing: 0 of them for a key that is not listed: 0
itself open 10 keys, 10 found, 10 writable, 10 configurable
asking threw TypeError
changing threw TypeError
-- stream finish  | stream end  | stream close 
== a duplex stream: preventExtensions a Proxy that traps defineProperty, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 10 keys, 10 found, 10 writable, 10 configurable
as that closed 10 keys, 10 found, 10 writable, 10 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream end  | nobody caught TypeError in endReadableNT
== a duplex stream: preventExtensions a Proxy that traps deleteProperty, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 10 keys, 10 found, 10 writable, 10 configurable
as that closed 10 keys, 10 found, 10 writable, 10 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream end  | nobody caught TypeError in endReadableNT
== a duplex stream: preventExtensions a Proxy that traps get, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 10 keys, 10 found, 10 writable, 10 configurable
as that closed 10 keys, 10 found, 10 writable, 10 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream end  | nobody caught TypeError in endReadableNT
== a duplex stream: preventExtensions a Proxy that traps getOwnPropertyDescriptor, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 10 keys, 10 found, 10 writable, 10 configurable
as that closed 10 keys, 10 found, 10 writable, 10 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream end  | nobody caught TypeError in endReadableNT
== a duplex stream: preventExtensions a Proxy that traps getPrototypeOf, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 10 keys, 10 found, 10 writable, 10 configurable
as that closed 10 keys, 10 found, 10 writable, 10 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream end  | nobody caught TypeError in endReadableNT
== a duplex stream: preventExtensions a Proxy that traps has, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 10 keys, 10 found, 10 writable, 10 configurable
as that closed 10 keys, 10 found, 10 writable, 10 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream end  | nobody caught TypeError in endReadableNT
== a duplex stream: preventExtensions a Proxy that traps isExtensible, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 10 keys, 10 found, 10 writable, 10 configurable
as that closed 10 keys, 10 found, 10 writable, 10 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream end  | nobody caught TypeError in endReadableNT
== a duplex stream: preventExtensions a Proxy that traps ownKeys, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 10 keys, 10 found, 10 writable, 10 configurable
as that closed 10 keys, 10 found, 10 writable, 10 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream end  | nobody caught TypeError in endReadableNT
== a duplex stream: preventExtensions a Proxy that traps preventExtensions, then used itself
traps while closing: 1 of them for a key that is not listed: 0
itself closed 10 keys, 10 found, 10 writable, 10 configurable
as that closed 10 keys, 10 found, 10 writable, 10 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream end  | nobody caught TypeError in endReadableNT
== a duplex stream: preventExtensions a Proxy that traps set, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 10 keys, 10 found, 10 writable, 10 configurable
as that closed 10 keys, 10 found, 10 writable, 10 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream end  | nobody caught TypeError in endReadableNT
== a writable stream: nothing itself, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself open 7 keys, 7 found, 7 writable, 7 configurable
as that open 7 keys, 7 found, 7 writable, 7 configurable
defined anew true added true removed true absent removed true absent found false
-- stream finish  | stream close 
== a writable stream: freeze itself, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed frozen 7 keys, 7 found, 0 writable, 0 configurable
as that closed sealed frozen 7 keys, 7 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream close 
== a writable stream: freeze a Proxy, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed frozen 7 keys, 7 found, 0 writable, 0 configurable
as that closed sealed frozen 7 keys, 7 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream close 
== a writable stream: freeze a Proxy, then used as that
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed frozen 7 keys, 7 found, 0 writable, 0 configurable
as that closed sealed frozen 7 keys, 7 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream close 
== a writable stream: freeze a Proxy of a Proxy, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed frozen 7 keys, 7 found, 0 writable, 0 configurable
as that closed sealed frozen 7 keys, 7 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream close 
== a writable stream: freeze a Proxy with every trap, then used itself
traps while closing: 16 of them for a key that is not listed: 0
itself closed sealed frozen 7 keys, 7 found, 0 writable, 0 configurable
as that closed sealed frozen 7 keys, 7 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream close 
== a writable stream: freeze a Proxy with every trap, then used as that
traps while closing: 16 of them for a key that is not listed: 0
itself closed sealed frozen 7 keys, 7 found, 0 writable, 0 configurable
as that closed sealed frozen 7 keys, 7 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream close 
== a writable stream: freeze a Proxy with every trap of a Proxy with every trap, then used itself
traps while closing: 70 of them for a key that is not listed: 0
itself closed sealed frozen 7 keys, 7 found, 0 writable, 0 configurable
as that closed sealed frozen 7 keys, 7 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream close 
== a writable stream: freeze a revoked Proxy, then used itself
closing threw TypeError
traps while closing: 0 of them for a key that is not listed: 0
itself open 7 keys, 7 found, 7 writable, 7 configurable
asking threw TypeError
changing threw TypeError
-- stream finish  | stream close 
== a writable stream: freeze a Proxy of a revoked Proxy, then used itself
closing threw TypeError
traps while closing: 0 of them for a key that is not listed: 0
itself open 7 keys, 7 found, 7 writable, 7 configurable
asking threw TypeError
changing threw TypeError
-- stream finish  | stream close 
== a writable stream: freeze a Proxy that traps defineProperty, then used itself
traps while closing: 7 of them for a key that is not listed: 0
itself closed sealed frozen 7 keys, 7 found, 0 writable, 0 configurable
as that closed sealed frozen 7 keys, 7 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream close 
== a writable stream: freeze a Proxy that traps deleteProperty, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed frozen 7 keys, 7 found, 0 writable, 0 configurable
as that closed sealed frozen 7 keys, 7 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream close 
== a writable stream: freeze a Proxy that traps get, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed frozen 7 keys, 7 found, 0 writable, 0 configurable
as that closed sealed frozen 7 keys, 7 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream close 
== a writable stream: freeze a Proxy that traps getOwnPropertyDescriptor, then used itself
traps while closing: 7 of them for a key that is not listed: 0
itself closed sealed frozen 7 keys, 7 found, 0 writable, 0 configurable
as that closed sealed frozen 7 keys, 7 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream close 
== a writable stream: freeze a Proxy that traps getPrototypeOf, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed frozen 7 keys, 7 found, 0 writable, 0 configurable
as that closed sealed frozen 7 keys, 7 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream close 
== a writable stream: freeze a Proxy that traps has, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed frozen 7 keys, 7 found, 0 writable, 0 configurable
as that closed sealed frozen 7 keys, 7 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream close 
== a writable stream: freeze a Proxy that traps isExtensible, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed frozen 7 keys, 7 found, 0 writable, 0 configurable
as that closed sealed frozen 7 keys, 7 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream close 
== a writable stream: freeze a Proxy that traps ownKeys, then used itself
traps while closing: 1 of them for a key that is not listed: 0
itself closed sealed frozen 7 keys, 7 found, 0 writable, 0 configurable
as that closed sealed frozen 7 keys, 7 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream close 
== a writable stream: freeze a Proxy that traps preventExtensions, then used itself
traps while closing: 1 of them for a key that is not listed: 0
itself closed sealed frozen 7 keys, 7 found, 0 writable, 0 configurable
as that closed sealed frozen 7 keys, 7 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream close 
== a writable stream: freeze a Proxy that traps set, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed frozen 7 keys, 7 found, 0 writable, 0 configurable
as that closed sealed frozen 7 keys, 7 found, 0 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream close 
== a writable stream: seal itself, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 7 keys, 7 found, 7 writable, 0 configurable
as that closed sealed 7 keys, 7 found, 7 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream close 
== a writable stream: seal a Proxy, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 7 keys, 7 found, 7 writable, 0 configurable
as that closed sealed 7 keys, 7 found, 7 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream close 
== a writable stream: seal a Proxy, then used as that
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 7 keys, 7 found, 7 writable, 0 configurable
as that closed sealed 7 keys, 7 found, 7 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream close 
== a writable stream: seal a Proxy of a Proxy, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 7 keys, 7 found, 7 writable, 0 configurable
as that closed sealed 7 keys, 7 found, 7 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream close 
== a writable stream: seal a Proxy with every trap, then used itself
traps while closing: 9 of them for a key that is not listed: 0
itself closed sealed 7 keys, 7 found, 7 writable, 0 configurable
as that closed sealed 7 keys, 7 found, 7 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream close 
== a writable stream: seal a Proxy with every trap, then used as that
traps while closing: 9 of them for a key that is not listed: 0
itself closed sealed 7 keys, 7 found, 7 writable, 0 configurable
as that closed sealed 7 keys, 7 found, 7 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream close 
== a writable stream: seal a Proxy with every trap of a Proxy with every trap, then used itself
traps while closing: 42 of them for a key that is not listed: 0
itself closed sealed 7 keys, 7 found, 7 writable, 0 configurable
as that closed sealed 7 keys, 7 found, 7 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream close 
== a writable stream: seal a revoked Proxy, then used itself
closing threw TypeError
traps while closing: 0 of them for a key that is not listed: 0
itself open 7 keys, 7 found, 7 writable, 7 configurable
asking threw TypeError
changing threw TypeError
-- stream finish  | stream close 
== a writable stream: seal a Proxy of a revoked Proxy, then used itself
closing threw TypeError
traps while closing: 0 of them for a key that is not listed: 0
itself open 7 keys, 7 found, 7 writable, 7 configurable
asking threw TypeError
changing threw TypeError
-- stream finish  | stream close 
== a writable stream: seal a Proxy that traps defineProperty, then used itself
traps while closing: 7 of them for a key that is not listed: 0
itself closed sealed 7 keys, 7 found, 7 writable, 0 configurable
as that closed sealed 7 keys, 7 found, 7 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream close 
== a writable stream: seal a Proxy that traps deleteProperty, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 7 keys, 7 found, 7 writable, 0 configurable
as that closed sealed 7 keys, 7 found, 7 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream close 
== a writable stream: seal a Proxy that traps get, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 7 keys, 7 found, 7 writable, 0 configurable
as that closed sealed 7 keys, 7 found, 7 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream close 
== a writable stream: seal a Proxy that traps getOwnPropertyDescriptor, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 7 keys, 7 found, 7 writable, 0 configurable
as that closed sealed 7 keys, 7 found, 7 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream close 
== a writable stream: seal a Proxy that traps getPrototypeOf, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 7 keys, 7 found, 7 writable, 0 configurable
as that closed sealed 7 keys, 7 found, 7 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream close 
== a writable stream: seal a Proxy that traps has, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 7 keys, 7 found, 7 writable, 0 configurable
as that closed sealed 7 keys, 7 found, 7 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream close 
== a writable stream: seal a Proxy that traps isExtensible, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 7 keys, 7 found, 7 writable, 0 configurable
as that closed sealed 7 keys, 7 found, 7 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream close 
== a writable stream: seal a Proxy that traps ownKeys, then used itself
traps while closing: 1 of them for a key that is not listed: 0
itself closed sealed 7 keys, 7 found, 7 writable, 0 configurable
as that closed sealed 7 keys, 7 found, 7 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream close 
== a writable stream: seal a Proxy that traps preventExtensions, then used itself
traps while closing: 1 of them for a key that is not listed: 0
itself closed sealed 7 keys, 7 found, 7 writable, 0 configurable
as that closed sealed 7 keys, 7 found, 7 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream close 
== a writable stream: seal a Proxy that traps set, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed sealed 7 keys, 7 found, 7 writable, 0 configurable
as that closed sealed 7 keys, 7 found, 7 writable, 0 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream close 
== a writable stream: preventExtensions itself, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 7 keys, 7 found, 7 writable, 7 configurable
as that closed 7 keys, 7 found, 7 writable, 7 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream close 
== a writable stream: preventExtensions a Proxy, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 7 keys, 7 found, 7 writable, 7 configurable
as that closed 7 keys, 7 found, 7 writable, 7 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream close 
== a writable stream: preventExtensions a Proxy, then used as that
traps while closing: 0 of them for a key that is not listed: 0
itself closed 7 keys, 7 found, 7 writable, 7 configurable
as that closed 7 keys, 7 found, 7 writable, 7 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream close 
== a writable stream: preventExtensions a Proxy of a Proxy, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 7 keys, 7 found, 7 writable, 7 configurable
as that closed 7 keys, 7 found, 7 writable, 7 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream close 
== a writable stream: preventExtensions a Proxy with every trap, then used itself
traps while closing: 1 of them for a key that is not listed: 0
itself closed 7 keys, 7 found, 7 writable, 7 configurable
as that closed 7 keys, 7 found, 7 writable, 7 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream close 
== a writable stream: preventExtensions a Proxy with every trap, then used as that
traps while closing: 1 of them for a key that is not listed: 0
itself closed 7 keys, 7 found, 7 writable, 7 configurable
as that closed 7 keys, 7 found, 7 writable, 7 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream close 
== a writable stream: preventExtensions a Proxy with every trap of a Proxy with every trap, then used itself
traps while closing: 3 of them for a key that is not listed: 0
itself closed 7 keys, 7 found, 7 writable, 7 configurable
as that closed 7 keys, 7 found, 7 writable, 7 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream close 
== a writable stream: preventExtensions a revoked Proxy, then used itself
closing threw TypeError
traps while closing: 0 of them for a key that is not listed: 0
itself open 7 keys, 7 found, 7 writable, 7 configurable
asking threw TypeError
changing threw TypeError
-- stream finish  | stream close 
== a writable stream: preventExtensions a Proxy of a revoked Proxy, then used itself
closing threw TypeError
traps while closing: 0 of them for a key that is not listed: 0
itself open 7 keys, 7 found, 7 writable, 7 configurable
asking threw TypeError
changing threw TypeError
-- stream finish  | stream close 
== a writable stream: preventExtensions a Proxy that traps defineProperty, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 7 keys, 7 found, 7 writable, 7 configurable
as that closed 7 keys, 7 found, 7 writable, 7 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream close 
== a writable stream: preventExtensions a Proxy that traps deleteProperty, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 7 keys, 7 found, 7 writable, 7 configurable
as that closed 7 keys, 7 found, 7 writable, 7 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream close 
== a writable stream: preventExtensions a Proxy that traps get, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 7 keys, 7 found, 7 writable, 7 configurable
as that closed 7 keys, 7 found, 7 writable, 7 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream close 
== a writable stream: preventExtensions a Proxy that traps getOwnPropertyDescriptor, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 7 keys, 7 found, 7 writable, 7 configurable
as that closed 7 keys, 7 found, 7 writable, 7 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream close 
== a writable stream: preventExtensions a Proxy that traps getPrototypeOf, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 7 keys, 7 found, 7 writable, 7 configurable
as that closed 7 keys, 7 found, 7 writable, 7 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream close 
== a writable stream: preventExtensions a Proxy that traps has, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 7 keys, 7 found, 7 writable, 7 configurable
as that closed 7 keys, 7 found, 7 writable, 7 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream close 
== a writable stream: preventExtensions a Proxy that traps isExtensible, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 7 keys, 7 found, 7 writable, 7 configurable
as that closed 7 keys, 7 found, 7 writable, 7 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream close 
== a writable stream: preventExtensions a Proxy that traps ownKeys, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 7 keys, 7 found, 7 writable, 7 configurable
as that closed 7 keys, 7 found, 7 writable, 7 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream close 
== a writable stream: preventExtensions a Proxy that traps preventExtensions, then used itself
traps while closing: 1 of them for a key that is not listed: 0
itself closed 7 keys, 7 found, 7 writable, 7 configurable
as that closed 7 keys, 7 found, 7 writable, 7 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream close 
== a writable stream: preventExtensions a Proxy that traps set, then used itself
traps while closing: 0 of them for a key that is not listed: 0
itself closed 7 keys, 7 found, 7 writable, 7 configurable
as that closed 7 keys, 7 found, 7 writable, 7 configurable
defined anew true added false removed true absent removed true absent found false
-- stream finish  | stream close 
643 cases, 0 unlike the object closed itself
*/
