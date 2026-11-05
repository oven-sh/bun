interface Schema<Out> {
  parse(value: unknown): Out;
}
type Infer<S> = S extends Schema<infer Out> ? Out : never;
interface Tool {
  inputSchema?: Schema<unknown>;
}
function validate<T extends Tool, Args extends T["inputSchema"] extends infer S ? (S extends Schema<unknown> ? Infer<S> : undefined) : undefined>(tool: T, args: Args): unknown {
  return tool.inputSchema ? tool.inputSchema.parse(args ?? {}) : undefined;
}
const tool: Tool = { inputSchema: { parse: (value: unknown) => value } };
const given: Record<string, unknown> | undefined = { a: 1 };
console.log(JSON.stringify(validate(tool, given)));
