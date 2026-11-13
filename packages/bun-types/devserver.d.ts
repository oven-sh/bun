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
     * previous version of a module can pass data to the next one. Using
     * `import.meta.hot.data` while the module is evaluated marks the module
     * as self-accepting (equivalent to calling `accept()`).
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
     * The module also takes the updates of the files that it imports. When
     * one of them is saved, Bun re-evaluates the saved file, every module
     * between it and this module, and this module. A module that Bun
     * re-evaluates starts again with new top-level variables. Keep state in
     * `import.meta.hot.data`.
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
     * and then calling the callback with it. Bun calls the callback that the
     * replaced copy of the module registered, and that copy keeps the imports
     * that it has: read new values from `newModule`. Bun also patches the importers
     * of this module, as it does for `accept()` without an argument.
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
     * dependency updates, Bun calls the callback with the new module. A save
     * of a file that the dependency imports also updates the dependency.
     *
     * If the same update also reaches this module through an import that it
     * does not accept, Bun does not call the callback. Bun re-evaluates this
     * module when a module above it accepts the update, and reloads the page
     * when none does.
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
     * rest. When one update replaces more than one of the dependencies, Bun
     * calls the callback once for each of them.
     *
     * When `import.meta.hot.accept` is not used, the page reloads when the
     * file updates, and a console message shows which files were checked.
     */
    accept(specifiers: string[], callback: (newModules: (any | undefined)[]) => void): void;

    /**
     * Attach a callback that Bun calls:
     * - Just before the module is replaced with another copy (before the next is loaded).
     *   This includes a module that Bun re-evaluates because a file that it imports was saved.
     *   Bun calls the callback during the update. A module that only an earlier `import()` call
     *   reached is disposed of then too, and gets its next copy later, at the next import,
     *   unless it accepts itself or the update calls an `accept("./dep", cb)` callback for it.
     * - After the module is detached (removing all imports to this module)
     *
     * The callback is not called on route navigation or when the browser tab closes.
     *
     * If a callback returns a promise, the update waits for it before it
     * evaluates the new modules. A module that a later `import()` evaluates
     * does not wait. All dispose callbacks are called in parallel.
     *
     * A copy of a module that an update replaced while it waited on a
     * top-level `await` can still register callbacks. Bun calls each of them
     * once: when that copy ends, or at the next update that reaches the
     * module if that comes first.
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
