interface Context {
  body: unknown;
  query: Record<string, string>;
  path: string;
}
type Handler = (context: Context) => unknown;
const handlers: Handler[] = [];
function get(handler: Handler): void {
  handlers.push(handler);
}
get(({ path }) => path);
const compose = new Function("handler", "return () => handler({ path: '/' })") as (handler: Handler) => () => unknown;
console.log(compose(handlers[0]!)());
