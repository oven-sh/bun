export function jsx(tag: unknown, props: unknown, key?: unknown): string { return "jsx:" + String(tag) + ":" + arguments.length; }
export function jsxs(tag: unknown, props: unknown, key?: unknown): string { return "jsxs:" + String(tag) + ":" + arguments.length; }
export const Fragment = "fragment-of-jsx-runtime";
export namespace JSX { export type Element = string; export interface IntrinsicElements { [name: string]: any } }
