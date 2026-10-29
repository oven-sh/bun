interface Schema<Out> {
  parse(value: unknown): Out;
}
type Infer<S> = S extends Schema<infer Out> ? Out : never;
interface Tool {
  inputSchema?: Schema<unknown>;
}
function isObject(value: unknown): boolean {
  return typeof value === "object" && value !== null;
}
function validate<T extends Tool, Args extends T["inputSchema"] extends infer S ? (S extends Schema<unknown> ? Infer<S> : undefined) : undefined>(tool: T, args: Args): boolean {
  return isObject(args);
}
const tool: Tool = { inputSchema: { parse: (value: unknown) => value } };
const given: Record<string, unknown> | undefined = { a: 1 };
console.log(validate(tool, given));
