// `new Response(other.body, other)` makes a Response from another one and shares its body with it. Whatever is done afterwards to either of the two gives what plain Bun gives.
const lines: string[] = [];
async function say(label: string, work: () => unknown) {
  let text: string;
  try {
    text = JSON.stringify(await work()) ?? "undefined";
  } catch (error) {
    text = "throws " + (error as Error).constructor.name + ": " + (error as Error).message;
  }
  lines.push(label + ": " + text);
}
async function outcome<T>(work: () => T | Promise<T>): Promise<T | string> {
  try {
    return await work();
  } catch (error) {
    return "throws " + (error as Error).constructor.name + ": " + (error as Error).message;
  }
}
const shown = (response: Response) => [response.status, response.statusText, response.ok, response.type, response.url, response.redirected, [...response.headers]];

function from(other: Response) {
  return new Response(other.body, other);
}
const streamOf = (text: string) => new Response(text).body;
function fromAnother(one: Response, another: Response) {
  return new Response(one.body, another);
}
const create = (body: ReadableStream | null, init: ResponseInit) => new Response(body, init);
function throughHelper(other: Response) {
  return create(other.body, other);
}
function readAhead(first: Response) {
  const body = first.body;
  return [body, new Response(body, first)] as const;
}
const calls: string[] = [];
function noted(response: Response) {
  calls.push("noted");
  return response;
}
function bodyOfACall(first: Response) {
  return new Response(first.body, noted(first));
}
class Context {
  #res: Response;
  constructor(res: Response) {
    this.#res = res;
  }
  header(name: string, value: string) {
    this.#res = new Response(this.#res.body, this.#res);
    this.#res.headers.set(name, value);
  }
  get res() {
    return this.#res;
  }
}
const usedAsValues = [from, fromAnother, throughHelper, readAhead, bodyOfACall, Context.prototype.header];
function made() {
  return new Response("hello", { status: 201, statusText: "Made", headers: { a: "1" } });
}

await say("each function is also used as a value", () => usedAsValues.map(each => each.name).join());
await say("status, status text and headers are taken over", () => shown(from(made())));
await say("the same Response twice, by two names", async () => {
  const first = made();
  const second = fromAnother(first, first);
  return [shown(second), first.body === second.body, await second.text(), first.bodyUsed];
});
await say("through a helper", async () => {
  const first = made();
  const second = throughHelper(first);
  return [shown(second), first.body === second.body, await second.text(), first.bodyUsed];
});
await say("the second operand is a call", async () => {
  const first = made();
  const second = bodyOfACall(first);
  return [calls, shown(second), first.body === second.body, await second.text()];
});
await say("a private field is read twice, as a framework does", async () => {
  const first = new Response('{"id":1}', { status: 200, headers: { "Content-Type": "application/json" } });
  const context = new Context(first);
  for (const name of ["x-request-id", "x-timing", "x-served-by"]) context.header(name, name.length + "");
  return [shown(context.res), first.body === context.res.body, await context.res.text(), first.bodyUsed, [...first.headers]];
});
await say("its body was asked for before", async () => {
  const first = made();
  const body = first.body;
  const second = from(first);
  return [body === second.body, body === first.body, await second.text()];
});
await say("the text is taken over", () => from(made()).text());
await say("the two share one body object", () => {
  const first = made();
  const second = from(first);
  return [first.body === second.body, first.body === first.body, second.body === second.body, first.body instanceof ReadableStream];
});
await say("nothing is used before a read", () => {
  const first = made();
  const second = from(first);
  return [first.bodyUsed, second.bodyUsed];
});
await say("reading the second uses the first", async () => {
  const first = made();
  const second = from(first);
  const text = await second.text();
  return [text, first.bodyUsed, second.bodyUsed, await outcome(() => first.text()), await outcome(() => second.text())];
});
await say("reading the first uses the second", async () => {
  const first = made();
  const second = from(first);
  const text = await outcome(() => first.text());
  return [text, first.bodyUsed, second.bodyUsed, await outcome(() => second.text())];
});
await say("the first's body is asked for only after the second was read", async () => {
  const first = made();
  const second = from(first);
  const text = await second.text();
  const body = first.body;
  return [text, body instanceof ReadableStream, body?.locked, first.bodyUsed, body === second.body];
});
await say("the first is read through its stream", async () => {
  const first = made();
  const second = from(first);
  const chunks: string[] = [];
  for await (const chunk of first.body!) chunks.push(new TextDecoder().decode(chunk));
  return [chunks, first.bodyUsed, second.bodyUsed, await outcome(() => second.text())];
});
await say("a reader on the first's body locks the second's", async () => {
  const first = made();
  const second = from(first);
  const reader = first.body!.getReader();
  const locked = [first.body!.locked, second.body!.locked, first.bodyUsed, second.bodyUsed];
  const read = await outcome(() => second.text());
  reader.releaseLock();
  return [locked, read];
});
for (const method of ["text", "json", "arrayBuffer", "bytes", "blob", "formData"] as const) {
  await say("the first's " + method + "() after the second was made", async () => {
    const first = new Response('{"a":1}', { headers: { "Content-Type": "application/json" } });
    const second = from(first);
    const value = await outcome<unknown>(() => first[method]());
    const size = value instanceof ArrayBuffer ? value.byteLength : value instanceof Uint8Array ? value.length : value instanceof Blob ? [value.size, value.type] : value;
    return [size, first.bodyUsed, second.bodyUsed];
  });
}
await say("the headers are a copy", () => {
  const first = made();
  const second = from(first);
  second.headers.set("b", "2");
  first.headers.set("c", "3");
  return [[...first.headers], [...second.headers], first.headers === second.headers];
});
await say("the headers were read before the second was made", () => {
  const first = made();
  const before = first.headers;
  before.set("early", "yes");
  const second = from(first);
  return [[...second.headers], first.headers === before];
});

const bodies: Record<string, () => BodyInit | null | undefined> = {
  "a string": () => "text",
  "an empty string": () => "",
  "a string that is not Latin-1": () => "snow ☃ and 🤭",
  null: () => null,
  undefined: () => undefined,
  bytes: () => new Uint8Array([104, 105]),
  "an ArrayBuffer": () => new Uint8Array([104, 105]).buffer,
  "a Blob": () => new Blob(["blob"], { type: "text/x-blob" }),
  URLSearchParams: () => new URLSearchParams("a=1&b=2"),
  "a stream": () =>
    new ReadableStream({
      start(controller: ReadableStreamDefaultController<Uint8Array>) {
        controller.enqueue(new TextEncoder().encode("streamed"));
        controller.close();
      },
    }),
};
for (const [kind, body] of Object.entries(bodies)) {
  await say("the body is " + kind, async () => {
    const first = new Response(body(), { status: 202 });
    const isNull = first.body === null;
    const second = from(first);
    return [isNull, second.body === null, first.body === second.body, shown(second), await second.text(), first.bodyUsed, second.bodyUsed];
  });
}
await say("made by Response.json", async () => {
  const second = from(Response.json({ id: 7 }, { status: 203 }));
  return [shown(second), await second.json()];
});
await say("form data keeps its boundary", async () => {
  const form = new FormData();
  form.set("field", "value");
  const first = new Response(form);
  const second = from(first);
  return [first.headers.get("content-type") === second.headers.get("content-type"), [...(await second.formData())]];
});

await say("the first was read already", async () => {
  const first = made();
  await first.text();
  return outcome(() => shown(from(first)));
});
await say("the first's body is locked", () => {
  const first = made();
  first.body!.getReader();
  return outcome(() => shown(from(first)));
});
for (const status of [200, 204, 205, 304, 599]) {
  await say("status " + status + " without a body", () => shown(from(new Response(null, { status }))));
}
await say("Response.error()", () => outcome(() => shown(from(Response.error()))));
await say("Response.redirect()", () => outcome(() => shown(from(Response.redirect("http://example.com/", 302)))));

await say("three in a row with a header each, as a framework does", async () => {
  let response = new Response('{"id":1}', { status: 200, headers: { "Content-Type": "application/json" } });
  const all = [response];
  for (const name of ["x-request-id", "x-timing", "x-served-by"]) {
    response = from(response);
    response.headers.set(name, name.length + "");
    all.push(response);
  }
  const text = await response.text();
  return [shown(response), text, all.map(each => each.bodyUsed), all.map(each => [...each.headers].length), all.every(each => each.body === response.body)];
});
await say("three in a row, the first one is read", async () => {
  const first = made();
  const third = from(from(first));
  return [await outcome(() => first.text()), third.bodyUsed, await outcome(() => third.text())];
});
await say("two are made from one", async () => {
  const first = made();
  const second = from(first);
  const third = await outcome(() => from(first));
  return [third instanceof Response, third instanceof Response && third.body === second.body, await outcome(() => second.text()), third instanceof Response ? await outcome(() => third.text()) : third];
});

await say("clone() of the first afterwards", async () => {
  const first = made();
  const second = from(first);
  const copy = await outcome(() => first.clone());
  return [copy instanceof Response ? await outcome(() => copy.text()) : copy, await outcome(() => second.text()), await outcome(() => first.text())];
});
await say("clone() of the second", async () => {
  const first = made();
  const second = from(first);
  const copy = second.clone();
  return [await copy.text(), await second.text(), first.bodyUsed];
});

await say("the body of one and the rest of another", async () => {
  const one = new Response("one", { status: 201, headers: { from: "one" } });
  const another = new Response("another", { status: 202, headers: { from: "another" } });
  const mixed = fromAnother(one, another);
  return [shown(mixed), await mixed.text(), one.bodyUsed, another.bodyUsed, await another.text()];
});
await say("the body is read ahead into a variable", async () => {
  const first = made();
  const [body, second] = readAhead(first);
  return [body === second.body, await second.text()];
});

const order: string[] = [];
class Logged extends Response {
  get body() {
    order.push("body");
    return super.body;
  }
  get status() {
    order.push("status");
    return 299;
  }
  get statusText() {
    order.push("statusText");
    return "Logged";
  }
  get headers() {
    order.push("headers");
    return new Headers({ logged: "yes" });
  }
}
await say("an instance of a subclass: its getters are called, in order", async () => {
  const second = from(new Logged("sub", { status: 201 }));
  return [order, shown(second), await second.text(), Object.getPrototypeOf(second) === Response.prototype];
});
await say("an own property on the first", () => {
  const first = made();
  Object.defineProperty(first, "status", { value: 298 });
  Object.defineProperty(first, "statusText", { value: "Own" });
  return shown(from(first));
});
await say("an own body on the first", async () => {
  const first = made();
  Object.defineProperty(first, "body", { value: streamOf("own body") });
  const second = from(first);
  return [await second.text(), first.bodyUsed, await first.text()];
});
await say("the first has another prototype", async () => {
  const first = made();
  Object.setPrototypeOf(first, { body: streamOf("from the other prototype"), status: 297 });
  const second = from(first);
  return [shown(second), await second.text()];
});
await say("not a Response at all", async () => {
  const second = from({ body: streamOf("plain"), status: 296, statusText: "Plain", headers: { plain: "yes" } } as unknown as Response);
  return [shown(second), await second.text()];
});
await say("a Request in place of the first", async () => {
  const request = new Request("http://example.com/", { method: "POST", body: "posted", headers: { r: "1" } });
  const second = from(request as unknown as Response);
  return [shown(second), await second.text(), request.bodyUsed];
});

await say("the second is dropped and the first is read", async () => {
  const first = made();
  (() => {
    from(first);
  })();
  Bun.gc(true);
  return [first.bodyUsed, await outcome(() => first.text())];
});
await say("the first is dropped and the second is read", async () => {
  const second = (() => from(made()))();
  Bun.gc(true);
  return second.text();
});
await say("many, with collections between", async () => {
  let length = 0;
  for (let i = 0; i < 300; i++) {
    let response = new Response("body " + i, { status: 200 + (i % 100), headers: { n: i + "" } });
    for (let k = 0; k < 3; k++) response = from(response);
    if (i % 50 === 0) Bun.gc(true);
    length += (await response.text()).length + response.status + Number(response.headers.get("n"));
  }
  return length;
});

await say("the global is replaced", async () => {
  const original = globalThis.Response;
  const seen: unknown[] = [];
  try {
    globalThis.Response = class extends original {
      constructor(body?: BodyInit | null, init?: ResponseInit) {
        seen.push([body instanceof ReadableStream, init instanceof original]);
        super(body, init);
      }
    };
    const second = from(new original("kept", { status: 201 }));
    return [seen, second.status, await second.text(), second instanceof original, Object.getPrototypeOf(second) === original.prototype];
  } finally {
    globalThis.Response = original;
  }
});
await say("the global is restored", async () => from(made()).text());

await say("served", async () => {
  using server = Bun.serve({
    port: 0,
    fetch() {
      let response = new Response("served body", { status: 201, headers: { "Content-Type": "text/x-served" } });
      for (const name of ["x-one", "x-two", "x-three"]) {
        response = from(response);
        response.headers.set(name, "set");
      }
      return response;
    },
  });
  const answer = await fetch(server.url);
  const names = ["content-type", "content-length", "transfer-encoding", "x-one", "x-two", "x-three"];
  return [answer.status, names.map(name => answer.headers.get(name)), await answer.text()];
});
await say("what is printed of the two", async () => {
  const first = made();
  const second = from(first);
  const before = [Bun.inspect(first), Bun.inspect(second)];
  await second.text();
  return [before, Bun.inspect(first), Bun.inspect(second)];
});
await say("the second's body is asked for first", () => {
  const first = made();
  const second = from(first);
  const body = second.body;
  return [body === first.body, body === second.body, body instanceof ReadableStream, body!.locked, first.bodyUsed, second.bodyUsed];
});
await say("a third is made after a body was asked for", async () => {
  const first = made();
  const second = from(first);
  const body = first.body;
  const third = from(second);
  return [body === third.body, body === second.body, await third.text(), first.bodyUsed, second.bodyUsed];
});
await say("a third is made after the second was read", async () => {
  const first = made();
  const second = from(first);
  await second.text();
  return [await outcome(() => shown(from(first))), await outcome(() => shown(from(second)))];
});
await say("the body goes on into another Response", async () => {
  const first = made();
  const second = from(first);
  const third = new Response(second.body);
  return [shown(third), await third.text(), first.bodyUsed, second.bodyUsed];
});
await say("the body goes on into a Request", async () => {
  const first = made();
  const second = from(first);
  const request = new Request("http://example.com/", { method: "POST", body: second.body });
  return [await request.text(), first.bodyUsed, second.bodyUsed];
});
await say("the body is read as a stream by Bun", async () => {
  const first = made();
  const second = from(first);
  return [await Bun.readableStreamToText(second.body!), first.bodyUsed, second.bodyUsed];
});
await say("the bytes of the second are its own", async () => {
  const bytes = new Uint8Array([1, 2, 3]);
  const first = new Response(bytes);
  const second = from(first);
  bytes[0] = 9;
  return [...(await second.bytes())];
});

const left = async (all: Response[]) => [
  all.map(each => each.bodyUsed),
  all.map(each => each.body instanceof ReadableStream && each.body.locked),
  all.map(each => each.body === all[0].body),
  await Promise.all(all.map(each => outcome(() => each.text()))),
  all.map(each => Bun.inspect(each).split("\n")[0]),
];
const answered = async (answer: Response) => [
  answer.status,
  ["content-type", "content-length", "transfer-encoding"].map(name => answer.headers.get(name)),
  await answer.text(),
];
const servedBodies: Record<string, () => BodyInit | null> = {
  "a string": () => "a served string",
  "a string that is not Latin-1": () => "snow ☃ served",
  bytes: () => new Uint8Array([115, 101, 114, 118, 101, 100]),
  "a Blob": () => new Blob(["a served blob"], { type: "text/x-blob" }),
  "an empty string": () => "",
  null: () => null,
};
for (const [kind, body] of Object.entries(servedBodies)) {
  for (const which of ["last", "first"] as const) {
    await say("served without a content type: " + kind + ", the " + which + " of three", async () => {
      const all: Response[] = [];
      using server = Bun.serve({
        port: 0,
        fetch() {
          all.push(new Response(body()));
          all.push(from(all[0]));
          all.push(from(all[1]));
          return which === "last" ? all[2] : all[0];
        },
      });
      return [await answered(await fetch(server.url)), await left(all)];
    });
  }
}
await say("served by a handler that waits", async () => {
  const all: Response[] = [];
  using server = Bun.serve({
    port: 0,
    async fetch() {
      all.push(made());
      await Promise.resolve();
      all.push(from(all[0]));
      await new Promise(resolve => setTimeout(resolve, 1));
      return all[1];
    },
  });
  return [await answered(await fetch(server.url)), await left(all)];
});
await say("served to HEAD", async () => {
  const all: Response[] = [];
  using server = Bun.serve({
    port: 0,
    fetch() {
      all.push(made());
      all.push(from(all[0]));
      return all[1];
    },
  });
  return [await answered(await fetch(server.url, { method: "HEAD" })), await left(all)];
});
await say("served after a look at bodyUsed", async () => {
  const all: Response[] = [];
  const used: boolean[] = [];
  using server = Bun.serve({
    port: 0,
    fetch() {
      all.push(made());
      all.push(from(all[0]));
      used.push(all[0].bodyUsed, all[1].bodyUsed);
      return all[1];
    },
  });
  return [await answered(await fetch(server.url)), used, await left(all)];
});
await say("another is made from what is left after serving", async () => {
  const all: Response[] = [];
  using server = Bun.serve({
    port: 0,
    fetch() {
      all.push(made());
      all.push(from(all[0]));
      return all[1];
    },
  });
  const answer = await answered(await fetch(server.url));
  return [answer, await outcome(() => shown(from(all[0]))), await outcome(() => shown(from(all[1])))];
});
await say("served many times, with collections between", async () => {
  using server = Bun.serve({
    port: 0,
    fetch(request) {
      let response = new Response("number " + new URL(request.url).pathname, { headers: { "Content-Type": "text/x-many" } });
      for (let k = 0; k < 3; k++) response = from(response);
      return response;
    },
  });
  let length = 0;
  for (let i = 0; i < 200; i++) {
    length += (await (await fetch(server.url + "" + i)).text()).length;
    if (i % 40 === 0) Bun.gc(true);
  }
  return length;
});
const meddlers: Record<string, (first: Response) => void> = {
  "does nothing": () => {},
  "asks for the body": first => void first.body,
  "asks whether the body is used": first => void first.bodyUsed,
  "clones the first": first => void first.clone(),
  "reads the first": first => void first.text(),
  "locks the body": first => void first.body!.getReader(),
  "makes another from the first": first => void from(first),
  "gives the first a body of its own": first => void Object.defineProperty(first, "body", { value: streamOf("own"), configurable: true }),
  "gives the first another prototype": first => void Object.setPrototypeOf(first, { body: streamOf("other"), status: 295 }),
  "sets a header on the first": first => void first.headers.set("late", "yes"),
};
for (const [what, meddle] of Object.entries(meddlers)) {
  await say("an accessor in place of the global " + what + " between the read and the construction", async () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "Response")!;
    const original = globalThis.Response;
    const first = made();
    let reads = 0;
    Object.defineProperty(globalThis, "Response", {
      configurable: true,
      get() {
        if (!reads++) meddle(first);
        return original;
      },
    });
    try {
      const second = await outcome(() => throughHelper(first));
      return [reads, second instanceof original ? [second.status, [...second.headers], await outcome(() => second.text())] : second, await outcome(() => first.bodyUsed)];
    } finally {
      Object.defineProperty(globalThis, "Response", descriptor);
    }
  });
}
await say("after the accessors, through the helper again", async () => {
  const first = made();
  const second = throughHelper(first);
  return [shown(second), first.body === second.body, await second.text(), first.bodyUsed];
});
console.log(lines.join("\n"));
