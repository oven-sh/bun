export {};

type ReactElement = typeof globalThis extends { React: infer React }
  ? React extends { createElement(...args: any): infer R }
    ? R
    : never
  : unknown;

export namespace JSX {
  /**
   * The type of a JSX expression: the return type of the global
   * `React.createElement` when one is declared, `unknown` when no
   * global `React` is declared.
   */
  export type Element = ReactElement;
}
