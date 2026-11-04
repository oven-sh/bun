// An awaited method call on a receiver that is written to be of one class and is of another with the same members, whose method is no async function and returns a thenable.
const log: string[] = [];
class Handler {
  n = 1;
  async load(request: number): Promise<unknown> {
    log.push("Handler.load");
    await null;
    return request + this.n;
  }
}
class Impostor {
  n = 100;
  load(request: number) {
    log.push("Impostor.load");
    const n = this.n;
    return {
      then(resolve: (v: unknown) => void) {
        log.push("then");
        resolve("impostor " + (request + n));
      },
    };
  }
}
async function serve(handler: Handler, request: number) {
  const answer = await handler.load(request + handler.n);
  log.push("served");
  return answer;
}
function deed(handler: unknown, request: number) {
  return serve(handler as Handler, request);
}
console.log(String(await deed(new Handler(), 1)));
console.log(String(await deed(new Impostor(), 2)));
for (let i = 0; i < 6; i++) console.log(String(await deed(i % 3 ? new Handler() : new Impostor(), i)));
console.log(String(await deed(JSON.parse('{"n":5}'), 3).catch(e => (e as Error).name)));
console.log(log.join(" | "));
