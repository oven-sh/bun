export function jsxDEV(tag: unknown, props: unknown, key: unknown, isStatic: boolean, source: unknown, self: object): string { return String(tag) + ":" + Object.keys(self).join(); }
export const Fragment = "fragment";
export namespace JSX { export type Element = string; export interface IntrinsicElements { [name: string]: any } }
