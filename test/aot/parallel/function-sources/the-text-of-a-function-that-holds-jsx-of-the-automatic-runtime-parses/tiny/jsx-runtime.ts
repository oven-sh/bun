export const jsx = (tag: unknown, props: unknown, key?: unknown) => ({ tag, props, key });
export const jsxs = jsx;
export const Fragment = "fragment";
export declare namespace JSX {
  type Element = any;
  interface IntrinsicElements {
    [name: string]: any;
  }
  interface ElementChildrenAttribute {
    children: unknown;
  }
}
