declare module "bun" {
  type HMREventNames =
    | "beforeUpdate"
    | "afterUpdate"
    | "beforeFullReload"
    | "beforePrune"
    | "invalidate"
    | "error"
    | "ws:disconnect"
    | "ws:connect";

  /**
   * Event names accepted by `import.meta.hot.on()` and `import.meta.hot.off()`
   */
  type HMREvent = `bun:${HMREventNames}` | (string & {});
}

interface ImportMeta {
  /**
   * Hot module replacement (HMR) APIs. In production this value is
   * `undefined`, so you can guard HMR code with an `if` statement:
   *
   * ```ts
   * if (import.meta.hot) {
   *   // HMR APIs are available
   * }
   * ```
   *
   * The check is usually unnecessary: Bun dead-code-eliminates calls to the
   * HMR APIs in production builds.
   *
   * https://bun.com/docs/bundler/hmr
   */
  hot: {
    /**
     * Persists state across module instances during hot replacement, so the
     * previous version of a module can pass data to the next one. Writing to
     * `import.meta.hot.data` marks the module as self-accepting (equivalent
     * to calling `accept()`).
     *
     * @example
     * ```ts
     * const root = import.meta.hot.data.root ??= createRoot(elem);
     * root.render(<App />); // re-use an existing root
     * ```
     *
     * In production, `data` is inlined to `{}`, which lets Bun minify
     * `{}.prop ??= value` to `value`.
     */
    data: any;

    /**
     * Indicate that this module can be replaced by re-evaluating the file.
     * After a hot update, Bun patches importers of this module automatically.
     *
     * When `import.meta.hot.accept` is not used, the page reloads when the
     * file updates, and a console message shows which files were checked.
     *
     * @example
     * ```ts
     * import { getCount } from "./foo";
     *
     * console.log("count is ", getCount());
     *
     * import.meta.hot.accept();
     * ```
     */
    accept(): void;

    /**
     * Indicate that this module can be replaced by evaluating the new module
     * and then calling the callback with it. In this mode, importers are not
     * patched. This matches Vite, which cannot patch import statements.
     * Prefer `import.meta.hot.accept()` without an argument; it usually makes
     * your code easier to understand.
     *
     * When `import.meta.hot.accept` is not used, the page reloads when the
     * file updates, and a console message shows which files were checked.
     *
     * @example
     * ```ts
     * export const count = 0;
     *
     * import.meta.hot.accept((newModule) => {
     *   if (newModule) {
     *     // newModule is undefined when SyntaxError happened
     *     console.log('updated: count is now ', newModule.count)
     *   }
     * });
     * ```
     *
     * In production, calls to this are dead-code-eliminated.
     */
    accept(cb: (newModule: any | undefined) => void): void;

    /**
     * Indicate that a dependency's module can be accepted. When the
     * dependency updates, Bun calls the callback with the new module.
     *
     * When `import.meta.hot.accept` is not used, the page reloads when the
     * file updates, and a console message shows which files were checked.
     *
     * @example
     * ```ts
     * import.meta.hot.accept('./foo', (newModule) => {
     *   if (newModule) {
     *     // newModule is undefined when SyntaxError happened
     *     console.log('updated: count is now ', newModule.count)
     *   }
     * });
     * ```
     */
    accept(specifier: string, callback: (newModule: any) => void): void;

    /**
     * Indicate that the modules of an array of dependencies can be accepted.
     * The callback receives the one updated module and `undefined` for the
     * rest.
     *
     * When `import.meta.hot.accept` is not used, the page reloads when the
     * file updates, and a console message shows which files were checked.
     */
    accept(specifiers: string[], callback: (newModules: (any | undefined)[]) => void): void;

    /**
     * Attach a callback that Bun calls:
     * - Just before the module is replaced with another copy (before the next is loaded)
     * - After the module is detached (removing all imports to this module)
     *
     * The callback is not called on route navigation or when the browser tab closes.
     *
     * Returning a promise delays module replacement until the module is
     * disposed. All dispose callbacks are called in parallel.
     */
    dispose(cb: (data: any) => void | Promise<void>): void;

    /**
     * No-op
     * @deprecated
     */
    decline(): void;

    // NOTE TO CONTRIBUTORS ////////////////////////////////////////
    //     Callback is currently never called for `.prune()`      //
    //     so the types are commented out until we support it.    //
    ////////////////////////////////////////////////////////////////
    // /**
    //  * Attach a callback that is called when the module is removed from the module graph.
    //  *
    //  * This can be used to clean up resources that were created when the module was loaded.
    //  * Unlike `import.meta.hot.dispose()`, this pairs much better with `accept` and `data` to manage stateful resources.
    //  *
    //  * @example
    //  * ```ts
    //  * export const ws = (import.meta.hot.data.ws ??= new WebSocket(location.origin));
    //  *
    //  * import.meta.hot.prune(() => {
    //  *   ws.close();
    //  * });
    //  * ```
    //  */
    // prune(callback: () => void): void;

    /**
     * Listen for an event from the dev server
     *
     * For Vite compatibility, event names also accept the `vite:` prefix in
     * place of `bun:`.
     *
     * https://bun.com/docs/bundler/hmr#import-meta-hot-on-and-off
     * @param event Event name, such as `"bun:beforeUpdate"`
     * @param callback Called each time the event is emitted
     */
    on(event: Bun.HMREvent, callback: () => void): void;

    /**
     * Stop listening for an event from the dev server
     *
     * For Vite compatibility, event names also accept the `vite:` prefix in
     * place of `bun:`.
     *
     * https://bun.com/docs/bundler/hmr#import-meta-hot-on-and-off
     * @param event Event name passed to `on()`
     * @param callback The callback passed to `on()`
     */
    off(event: Bun.HMREvent, callback: () => void): void;
  };
}
