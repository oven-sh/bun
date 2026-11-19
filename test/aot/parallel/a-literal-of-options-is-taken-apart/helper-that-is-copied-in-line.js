// STATISTIC: LiteralArgumentsScalarized >= 1
const createResponse = (body, init) => new Response(body, init);
class Context {
  #status = 200;
  #headers;
  status(code) { this.#status = code; }
  header(name, value) { (this.#headers ??= new Headers()).set(name, value); }
  #respond(data, given) {
    const headers = this.#headers ?? new Headers();
    const status = typeof given === "number" ? given : this.#status;
    return createResponse(data, { status, headers });
  }
  text(text, status) { return this.#respond(text, status); }
}
for (let turn = 0; turn < 4; turn++) {
  const context = new Context();
  if (turn & 1) context.status(202);
  context.header("x-turn", "t" + turn);
  const made = context.text("hello " + turn, turn === 3 ? 203 : undefined);
  console.log(made.status, [...made.headers].join("|"), await made.text());
}
