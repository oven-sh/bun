export {};

declare global {
	interface ImportMeta {
		/**
		 * Hot module replacement APIs. This value is `undefined` in production and
		 * can be used in an `if` statement to check if HMR APIs are available
		 *
		 * ```ts
		 * if (import.meta.hot) {
		 *   // HMR APIs are available
		 * }
		 * ```
		 *
		 * However, this check is usually not needed as Bun will dead-code-eliminate
		 * calls to all of the HMR APIs in production builds.
		 *
		 * https://bun.sh/docs/bundler/hmr
		 */
		hot: {
			/**
			 * `import.meta.hot.data` maintains state between module instances during
			 * hot replacement, enabling data transfer from previous to new versions.
			 * When `import.meta.hot.data` is written to, Bun will mark this module as
			 * capable of self-accepting (equivalent of calling `accept()`).
			 *
			 * @example
			 * ```ts
			 * const root = import.meta.hot.data.root ??= createRoot(elem);
			 * root.render(<App />); // re-use an existing root
			 * ```
			 *
			 * In production, `data` is inlined to be `{}`. This is handy because Bun
			 * knows it can minify `{}.prop ??= value` into `value` in production.
			 *
			 *
			 */
			data: any;

			/**
			 * Indicate that this module can be replaced simply by re-evaluating the
			 * file. After a hot update, importers of this module will be
			 * automatically patched.
			 *
			 * When `import.meta.hot.accept` is not used, the page will reload when
			 * the file updates, and a console message shows which files were checked.
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
			 * Indicate that this module can be replaced by evaluating the new module,
			 * and then calling the callback with the new module. In this mode, the
			 * importers do not get patched. This is to match Vite, which is unable
			 * to patch their import statements. Prefer using `import.meta.hot.accept()`
			 * without an argument as it usually makes your code easier to understand.
			 *
			 * When `import.meta.hot.accept` is not used, the page will reload when
			 * the file updates, and a console message shows which files were checked.
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
			 * Indicate that a dependency's module can be accepted. When the dependency
			 * is updated, the callback will be called with the new module.
			 *
			 * When `import.meta.hot.accept` is not used, the page will reload when
			 * the file updates, and a console message shows which files were checked.
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
			 * Indicate that a dependency's module can be accepted. This variant
			 * accepts an array of dependencies, where the callback will receive
			 * the one updated module, and `undefined` for the rest.
			 *
			 * When `import.meta.hot.accept` is not used, the page will reload when
			 * the file updates, and a console message shows which files were checked.
			 */
			accept(
				specifiers: string[],
				callback: (newModules: (any | undefined)[]) => void,
			): void;

			/**
			 * Attach an on-dispose callback. This is called:
			 * - Just before the module is replaced with another copy (before the next is loaded)
			 * - After the module is detached (removing all imports to this module)
			 *
			 * This callback is not called on route navigation or when the browser tab closes.
			 *
			 * Returning a promise will delay module replacement until the module is
			 * disposed. All dispose callbacks are called in parallel.
			 */
			dispose(cb: (data: any) => void | Promise<void>): void;

			/**
			 * No-op
			 * @deprecated
			 */
			decline(): void;
		};
	}
}
