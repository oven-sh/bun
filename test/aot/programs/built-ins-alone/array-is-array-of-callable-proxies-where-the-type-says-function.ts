// Array.isArray of callable proxies, live and revoked, where a declared type or `typeof` says function: out of a list of unknown values, of typed parameters and of a field.
type Handler = () => void;
const { proxy: revoked, revoke } = Proxy.revocable((): void => {}, {});
const live: Handler = new Proxy(function (): void {}, {});
revoke();

const list: unknown[] = [revoked, live, () => {}, [revoked], "text"];
list.forEach((value, index) => {
  try {
    if (typeof value === "function") console.log("callback", index, Array.isArray(value));
  } catch (error) {
    console.log("callback", index, String(error));
  }
});

function count(handlers: Handler | Handler[]): number {
  return Array.isArray(handlers) ? handlers.length : -1;
}
function isList(handler: Handler): boolean {
  return Array.isArray(handler);
}
function isListOfFunction(handler: Function): boolean {
  return Array.isArray(handler);
}
class Route {
  constructor(public handler: Handler | Handler[]) {}
  count(): number {
    return Array.isArray(this.handler) ? this.handler.length : -1;
  }
}
for (const handler of [revoked, live, () => {}]) {
  for (const ask of [count, isList, isListOfFunction, (value: Handler) => new Route(value).count()]) {
    try {
      console.log(ask.name, ask(handler));
    } catch (error) {
      console.log(ask.name, String(error));
    }
  }
}
console.log(count([revoked, live]), new Route([revoked]).count());
