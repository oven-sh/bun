// Functions made from text call typed handlers with objects that lack declared fields.
interface Context {
  body: unknown;
  query: Record<string, string>;
  path: string;
}
type Handler = (context: Context) => unknown;
type Compose = (handler: Handler) => () => unknown;
const handlers: Handler[] = [];
function get(handler: Handler): void {
  handlers.push(handler);
}
const fromConstructor = new Function("handler", "return () => handler({ path: '/a' })") as Compose;
const fromUnknownText = new Function(
  "handler",
  process.argv[2] ?? ["return () => handler({ path:", "'/b' })"].join(" "),
) as Compose;
const fromEval = (0, eval)("(handler) => () => handler({ path: '/c' })") as Compose;
const complete = new Function("handler", "return () => handler({ body: 1, query: {}, path: '/d' })") as Compose;
get(({ path }) => path);
console.log(fromConstructor(handlers[0]!)());
console.log(fromConstructor((context: Context) => context.path)());
console.log(fromUnknownText((context: Context) => context.path + String(context.body))());
console.log(fromEval(({ path, query }) => path + typeof query)());
console.log(complete(({ path, query }) => path + typeof query)());
