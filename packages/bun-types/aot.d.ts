/**
 * The type argument of `JSON.parse<T>(text)` on the global `JSON`. Nothing includes this file for you:
 *
 * ```ts
 * /// <reference types="bun-types/aot" />
 * ```
 *
 * or `"types": ["bun", "bun-types/aot"]` in `tsconfig.json`.
 *
 * You don't need it for `import { JSON } from "bun"`, which has the type argument already, and
 * `bun build --compile --aot` needs neither. It is kept apart because a second signature on the global
 * `JSON.parse` changes programs that never pass a type argument: TypeScript infers no parameter types for a function
 * expression that is typed as `typeof JSON.parse`, or for a `parse` method in an object that is typed as `JSON`.
 */

interface JSON {
  /**
   * Parses `text` and validates the result against the TypeScript type `T`.
   *
   * Returns the same value as `JSON.parse(text)`, including properties that `T` doesn't declare.
   * Throws a `SyntaxError` if `text` isn't valid JSON, and a `TypeError` whose `issues` property lists every
   * {@link Bun.Schema.Issue} if the value doesn't match `T`.
   *
   * `bun build --compile --aot`, `bun run --aot` and `bun test --aot` validate. Everywhere else the type argument is
   * erased like any other type, and nothing is validated. `JSON.parse(text)` and `JSON.parse<any>(text)` never
   * validate.
   *
   * ```ts
   * interface User { id: number; name: string }
   * const user = JSON.parse<User>(text);
   * ```
   */
  parse<T = any>(text: string, reviver?: (this: any, key: string, value: any) => any): T;
}

// Kept apart: TypeScript tries a later declaration's overloads first and infers (`ReturnType`, `.then(JSON.parse)`) from the last one, so `JSON.parse(text)` stays `any`.
interface JSON {
  /**
   * Converts a JavaScript Object Notation (JSON) string into an object.
   * @param text A valid JSON string.
   * @param reviver A function that transforms the results. This function is called for each member of the object.
   * If a member contains nested objects, the nested objects are transformed before the parent object is.
   * @throws {SyntaxError} If `text` is not valid JSON.
   */
  parse(text: string, reviver?: (this: any, key: string, value: any) => any): any;
}
