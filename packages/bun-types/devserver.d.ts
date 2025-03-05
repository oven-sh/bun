export {};

declare global {
  interface ImportMeta {
    /**
     * Hot module replacement
     *
     * https://bun.sh/docs/bundler/fullstack
     */
    hot: {
      /**
       * import.meta.hot.data maintains state between module instances during hot replacement, enabling data transfer from previous to new versions.
       *
       * @example
       * ```ts
       * import.meta.hot.data = {
       *   bun: 'is cool',
       * };
       * ```
       */
      data: any;
    };
  }
}
