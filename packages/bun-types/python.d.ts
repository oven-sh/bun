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

  /**
   * A function for Python that passes its first argument to `body` as `this`: what a `def` with `self` is. For where Python
   * takes a function and calls it with the instance, as `property()` does. (A `function` that is put in a class is a method
   * of the instances as it is, and so are the methods of a `class` that extends a class of Python's.)
   *
   * @example
   * ```ts
   * import { method } from "bun:python";
   * import { property } from "python:builtins";
   *
   * Circle.area = property(method(function () { return Math.PI * this.radius ** 2; }));
   * ```
   */
  function method(body: (this: any, ...args: any[]) => unknown): any;

  /**
   * Python's `with` statement: `withStatement(a, b, body)` is `with a as x, b as y: return body(x, y)`.
   *
   * What the body throws is told to the managers, which may swallow it: the result is then `undefined`. If the body returns a
   * promise, as an async function does, the managers are left when that is settled, and the result is a promise.
   *
   * @example
   * ```ts
   * import python from "bun:python";
   * import { open } from "python:builtins";
   *
   * const text = python.with(open("notes.txt"), file => file.read());
   * ```
   */
  function withStatement<T>(...managersAndBody: [...managers: unknown[], body: (...values: any[]) => T]): T | undefined;

  /**
   * Python's `async with` statement: `asyncWith(a, b, body)` is `async with a as x, b as y: return await body(x, y)`, all of
   * it in one task, so what cancels the task it is used in (`asyncio.timeout()`, `asyncio.TaskGroup()`) cancels what the body
   * returns.
   *
   * @example
   * ```ts
   * import { asyncWith } from "bun:python";
   * import asyncio from "python:asyncio";
   *
   * await asyncWith(asyncio.timeout(1), () => queue.get());
   * ```
   */
  function asyncWith<T>(
    ...managersAndBody: [...managers: unknown[], body: (...values: any[]) => T | PromiseLike<T>]
  ): Promise<T | undefined>;

  function importModule(name: string): any;

  export {
    asyncWith,
    float,
    /**
     * The module of that name, as `import` in Python finds it: `python.import("os.path")`.
     *
     * The same as `require("python:os.path")`.
     */
    importModule as import,
    kwargs,
    method,
    withStatement as with,
    type KeywordArguments,
  };

  const python: {
    asyncWith: typeof asyncWith;
    float: typeof float;
    import: typeof importModule;
    kwargs: typeof kwargs;
    method: typeof method;
    with: typeof withStatement;
  };
  export default python;
}
