// A function of the program named Function is not the Function constructor.
interface Context {
  body: unknown;
  query: Record<string, string>;
  path: string;
}
type Handler = (context: Context) => unknown;
function Function(handler: Handler): () => unknown {
  return () => handler({ body: 1, query: {}, path: "/" });
}
console.log(Function((context: Context) => context.path)());
interface Control {
  control: number;
}
const control: Control = JSON.parse('{"control":1}');
console.log(control.control);
