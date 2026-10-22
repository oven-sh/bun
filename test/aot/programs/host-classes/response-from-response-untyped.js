// Untyped code, as a framework writes it: the construction stands in a helper, the Response in a private field that is read twice.
const createResponse = (body, init) => new Response(body, init);
const log = [];
class Context {
  #res;
  finalized = false;
  header(name, value) {
    if (this.finalized) this.#res = createResponse(this.#res.body, this.#res);
    this.#res.headers.set(name, value);
  }
  replace(next) {
    if (this.#res && next) {
      next = createResponse(next.body, next);
      for (const [name, value] of this.#res.headers.entries()) {
        if (name !== "content-type") next.headers.set(name, value);
      }
    }
    this.#res = next;
    this.finalized = true;
  }
  get res() {
    return this.#res;
  }
}
class Watched {
  #held;
  #reads = 0;
  meddle = () => {};
  constructor(held) {
    this.#held = held;
  }
  get #res() {
    log.push("read " + ++this.#reads);
    if (this.#reads === 2) this.meddle(this.#held);
    return this.#held;
  }
  throughAccessor() {
    return createResponse(this.#res.body, this.#res);
  }
}
const usedAsValues = [Context.prototype.header, Context.prototype.replace, Watched.prototype.throughAccessor];
const outcome = async work => {
  try {
    return await work();
  } catch (error) {
    return "throws " + error.constructor.name + ": " + error.message;
  }
};
const shown = response => [response.status, response.statusText, [...response.headers]];
const made = () => new Response('{"id":1}', { status: 201, statusText: "Made", headers: { "Content-Type": "application/json" } });
const lines = [usedAsValues.map(each => each.name).join()];
{
  const first = made();
  const context = new Context();
  context.replace(first);
  for (const name of ["x-request-id", "x-content-type-options", "cache-control"]) context.header(name, name.length + "");
  lines.push(JSON.stringify([shown(context.res), context.res === first, first.body === context.res.body, await context.res.text(), first.bodyUsed, [...first.headers]]));
}
{
  const context = new Context();
  context.replace(new Response("first", { headers: { a: "1", "Content-Type": "text/x-first" } }));
  context.replace(new Response("second", { status: 202, headers: { b: "2", "Content-Type": "text/x-second" } }));
  lines.push(JSON.stringify([shown(context.res), await context.res.text()]));
}
for (const [what, meddle] of Object.entries({
  nothing: () => {},
  "a clone": held => void held.clone(),
  "a read": held => void held.text(),
  "a reader": held => void held.body.getReader(),
})) {
  const watched = new Watched(made());
  watched.meddle = meddle;
  log.length = 0;
  const second = await outcome(() => watched.throughAccessor());
  lines.push(JSON.stringify([what, log, second instanceof Response ? [shown(second), await outcome(() => second.text())] : second]));
}
{
  const context = new Context();
  const kind = async work => (await outcome(work)).split(":")[0];
  lines.push(JSON.stringify(await kind(() => Context.prototype.header.call({ finalized: true }, "a", "b"))));
  lines.push(JSON.stringify(await kind(() => context.header("a", "b"))));
}
{
  using server = Bun.serve({
    port: 0,
    async fetch() {
      const context = new Context();
      context.replace(made());
      await Promise.resolve();
      for (const name of ["x-one", "x-two", "x-three"]) context.header(name, "set");
      return context.res;
    },
  });
  const answer = await fetch(server.url);
  lines.push(JSON.stringify([answer.status, ["content-type", "content-length", "transfer-encoding", "x-one", "x-two", "x-three"].map(name => answer.headers.get(name)), await answer.text()]));
}
console.log(lines.join("\n"));
