export const Fragment = "<>"
export type Node = { type: unknown, props: Record<string, unknown>, key: unknown }
export function jsx(type: unknown, props: Record<string, unknown>, key?: unknown): Node { return { type, props, key } }
export const jsxs = jsx
export function jsxDEV(type: unknown, props: Record<string, unknown>, key?: unknown): Node { return { type, props, key } }
export namespace JSX { export type Element = Node; export interface IntrinsicElements { [name: string]: any }; export interface IntrinsicAttributes { key?: unknown }; export interface ElementChildrenAttribute { children: {} } }
