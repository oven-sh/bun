export interface Context {
  body: unknown;
  query: Record<string, string>;
  path: string;
}
export type Handler = (context: Context) => unknown;
export const handlers: Handler[] = [];
export function get(handler: Handler): void {
  handlers.push(handler);
}
export const compose = new Function("handler", "return () => handler({ path: '/' })") as (
  handler: Handler,
) => () => unknown;
