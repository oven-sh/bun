export function jsxDEV(tag: unknown, props: unknown, key: unknown, isStatic: unknown, source: unknown, self: unknown): string {
  return String(tag) + ":" + (typeof self === "object" && self !== null ? Object.keys(self).join() : String(self));
}
export const Fragment = "fragment";
export namespace JSX { export type Element = string; export interface IntrinsicElements { [name: string]: any } }
