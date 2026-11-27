export function jsx(tag: unknown, props: unknown, key?: unknown): string { return String(tag) + ":" + String(key) + ":" + JSON.stringify(props); }
export const Fragment = "fragment";
export namespace JSX { export type Element = string; export interface IntrinsicElements { [name: string]: any } }
