console.log("the runtime is evaluated");
export function jsx(type: string): string { return type; }
export const jsxs = jsx;
export const jsxDEV = jsx;
export const Fragment = "fragment";
export namespace JSX {
  export type Element = string;
  export interface IntrinsicElements { [name: string]: any }
}
