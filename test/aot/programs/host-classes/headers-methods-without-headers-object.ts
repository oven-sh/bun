// The same in typed code, in the shape a framework's context has: the Headers come from the Response at hand or from a field, and three methods are called on what was joined.
type Options = { append?: boolean };

class Context {
  #response: Response | undefined;
  #prepared: Headers | undefined;
  finalized = false;

  get response(): Response {
    return (this.#response ??= new Response(null, { headers: (this.#prepared ??= new Headers()) }));
  }
  set response(response: Response) {
    this.#response = response;
    this.finalized = true;
  }
  header = (name: string, value: string | undefined, options?: Options): void => {
    if (this.finalized) this.#response = new Response((this.#response as Response).body, this.#response);
    const headers = this.#response ? this.#response.headers : (this.#prepared ??= new Headers());
    if (value === undefined) headers.delete(name);
    else if (options?.append) headers.append(name, value);
    else headers.set(name, value);
  };
}

export function vary(response: Response, by: string): void {
  response.headers.append("vary", by);
}
export function cached(response: Response): boolean {
  const headers = response.headers;
  return headers.has("etag") || headers.has("Last-Modified");
}

const show = (headers: Headers) => JSON.stringify([[...headers], headers.getSetCookie()]);

const early = new Context();
early.header("x-early", "1");
early.header("x-early", "2", { append: true });
early.header("content-type", "early/type");
early.header("x-gone", "soon");
early.header("x-gone", undefined);
console.log(show(early.response.headers));

const late = new Context();
late.response = new Response("body", { status: 201, headers: { "content-type": "first/type", "x-first": "kept" } });
const first = late.response;
late.header("x-request-id", "seven");
late.header("x-content-type-options", "nosniff");
late.header("cache-control", "no-store");
late.header("set-cookie", "a=1", { append: true });
late.header("Set-Cookie", "b=2", { append: true });
late.header("x-first", undefined);
console.log(late.response === first, late.response.status, show(late.response.headers), show(first.headers), await late.response.text());
for (const [name, value] of [["bad name", "v"], ["x-bad-value", "two\nlines"], ["", "v"]]) {
  try {
    late.header(name, value);
    console.log("no error");
  } catch (error) {
    console.log(`${(error as Error).name}: ${(error as Error).message}`);
  }
}

const varied = new Response("x");
vary(varied, "accept");
vary(varied, "origin");
console.log(show(varied.headers), cached(varied), cached(new Response("", { headers: { ETag: "1" } })), cached(new Response("", { headers: { "last-modified": "now" } })));
const seen = new Response("x");
const object = seen.headers;
vary(seen, "accept");
console.log(object.get("vary"), cached(seen), (object.set("etag", "2"), cached(seen)));

const server = Bun.serve({
  port: 0,
  routes: {
    "/routed/:id": (request) => {
      const context = new Context();
      context.header("x-before", request.params.id);
      context.response = Response.json({ id: request.params.id }, { headers: context.response.headers });
      context.header("x-request-id", request.headers.get("x-request-id") ?? "none");
      context.header("cache-control", "no-store");
      vary(context.response, "x-request-id");
      return context.response;
    },
  },
  fetch: () => new Response("not found", { status: 404 }),
});
for (let turn = 0; turn < 2; turn++) {
  const response = await fetch(new URL(`/routed/${turn}`, server.url), { headers: { "x-request-id": `turn-${turn}` } });
  console.log(response.status, JSON.stringify([...response.headers].filter(([name]) => name !== "date")), await response.text());
}
await server.stop(true);
