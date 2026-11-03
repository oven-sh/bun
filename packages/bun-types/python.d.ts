/**
 * A module of Python's, imported by name: `python:json` is what `import json` gives in Python, as `node:fs` names a module of
 * Node's. Any module Python can import by name can be imported so, with dots for a module in a package (`python:os.path`).
 *
 * The default export is the module. The named exports are its attributes at the time it was imported.
 *
 * @example
 * ```ts
 * import json, { dumps } from "python:json";
 * import { kwargs } from "bun:python";
 *
 * dumps([1, 2, [3]], kwargs({ indent: 2 }));
 * json.loads("[1, 2]"); // [1, 2]
 * ```
 */
declare module "python:*";

/**
 * A module written in Python, imported by its path.
 *
 * The default export is the module. The named exports are its attributes at the time it was imported.
 */
declare module "*.py";

/**
 * What JavaScript needs to talk to Python besides importing its modules.
 */
declare module "bun:python" {
  /**
   * What {@link kwargs} returns. It means something only as the last argument of a call.
   */
  interface KeywordArguments {
    readonly [kind: symbol]: unknown;
  }

  /**
   * Keyword arguments, as the last argument of a call of something of Python's.
   *
   * @example
   * ```ts
   * import { kwargs } from "bun:python";
   * import { sorted } from "python:builtins";
   *
   * sorted(["b", "A"], kwargs({ key: (s: string) => s.toLowerCase(), reverse: true })); // sorted(["b", "A"], key=..., reverse=True)
   * ```
   */
  function kwargs(keywords: Record<string, unknown>): KeywordArguments;

  /**
   * A `float`. To Python a whole number is an `int`: `float(2)` is `2.0`.
   */
  function float(value: number): unknown;

  function importModule(name: string): any;

  export {
    float,
    /**
     * The module of that name, as `import` in Python finds it: `python.import("os.path")`.
     *
     * The same as `require("python:os.path")`.
     */
    importModule as import,
    kwargs,
    type KeywordArguments,
  };

  const python: {
    float: typeof float;
    import: typeof importModule;
    kwargs: typeof kwargs;
  };
  export default python;
}
