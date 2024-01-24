/// <reference path="index.d.ts" />

declare module "bun" {
  interface TOML {
    /**
     * Parse a TOML string into a JavaScript object.
     *
     * @param {string} command The name of the executable or script
     * @param {string} options.PATH Overrides the PATH environment variable
     * @param {string} options.cwd Limits the search to a particular directory in which to searc
     */
    parse(input: string): unknown;
  }

  interface ShellPromise {
    json(): Promise<unknown>
  }

  /**
   * Consume all data from a {@link ReadableStream} until it closes or errors.
   *
   * Concatenate the chunks into a single string and parse as JSON. Chunks must be a TypedArray or an ArrayBuffer. If you need to support chunks of different types, consider {@link readableStreamToBlob}.
   *
   * @param stream The stream to consume.
   * @returns A promise that resolves with the concatenated chunks as a {@link String}.
   */
  function readableStreamToJSON(stream: ReadableStream): Promise<unknown>;

}

declare namespace global {
  interface Blob {
    json(): Promise<unknown>
  }

  interface JSON {
    /**
     * Converts a JavaScript Object Notation (JSON) string into an object.
     * @param text A valid JSON string.
     * @param reviver A function that transforms the results. This function is called for each member of the object.
     * If a member contains nested objects, the nested objects are transformed before the parent object is.
    */
    parse(text: string, reviver?: (this: any, key: string, value: any) => any): unknown;
  }

  // Allow `<Array>.filter(Boolean)` to properly reflect
  interface Array<T> {
    filter(predicate: BooleanConstructor, thisArg?: any): T[];
  }

  interface ReadonlyArray<T> {
    filter(predicate: BooleanConstructor, thisArg?: any): T[];
  }

  interface ArrayConstructor {
    isArray(arg: any): arg is unknown[];
  }

  interface ShadowRealm {
    /**
     * Creates a new [ShadowRealm](https://github.com/tc39/proposal-shadowrealm/blob/main/explainer.md#introduction)
     *
     * @example
     *
     * ```js
     * const red = new ShadowRealm();
     *
     * // realms can import modules that will execute within it's own environment.
     * // When the module is resolved, it captured the binding value, or creates a new
     * // wrapped function that is connected to the callable binding.
     * const redAdd = await red.importValue('./inside-code.js', 'add');
     *
     * // redAdd is a wrapped function exotic object that chains it's call to the
     * // respective imported binding.
     * let result = redAdd(2, 3);
     *
     * console.assert(result === 5); // yields true
     *
     * // The evaluate method can provide quick code evaluation within the constructed
     * // shadowRealm without requiring any module loading, while it still requires CSP
     * // relaxing.
     * globalThis.someValue = 1;
     * red.evaluate('globalThis.someValue = 2'); // Affects only the ShadowRealm's global
     * console.assert(globalThis.someValue === 1);
     *
     * // The wrapped functions can also wrap other functions the other way around.
     * const setUniqueValue =
     * await red.importValue('./inside-code.js', 'setUniqueValue');
     *
     * // setUniqueValue = (cb) => (cb(globalThis.someValue) * 2);
     *
     * result = setUniqueValue((x) => x ** 3);
     *
     * console.assert(result === 16); // yields true
     * ```
     */
    importValue(specifier: string, bindingName: string): Promise<unknown>;
  }
}