/**
 * The `bun:bundle` module provides compile-time utilities: feature flags for dead-code elimination, and validation
 * against TypeScript types.
 *
 * @example
 * ```ts
 * import { feature } from "bun:bundle";
 *
 * if (feature("SUPER_SECRET")) {
 *   console.log("Secret feature enabled!");
 * } else {
 *   console.log("Normal mode");
 * }
 * ```
 *
 * Enable feature flags from the CLI:
 * ```bash
 * # During build
 * bun build --feature=SUPER_SECRET index.ts
 *
 * # At runtime
 * bun run --feature=SUPER_SECRET index.ts
 *
 * # In tests
 * bun test --feature=SUPER_SECRET
 * ```
 *
 * @module bun:bundle
 */
declare module "bun:bundle" {
  /**
   * Registry for type-safe feature flags.
   *
   * Augment this interface to get autocomplete and type checking for your feature flags:
   *
   * @example
   * ```ts
   * // env.d.ts
   * declare module "bun:bundle" {
   *   interface Registry {
   *     features: "DEBUG" | "PREMIUM" | "BETA";
   *   }
   * }
   * ```
   *
   * Now `feature()` only accepts `"DEBUG"`, `"PREMIUM"`, or `"BETA"`:
   * ```ts
   * feature("DEBUG");    // OK
   * feature("TYPO");     // Type error
   * ```
   */
  interface Registry {}

  /**
   * Checks whether a feature flag is enabled at compile time.
   *
   * At bundle time, Bun replaces each call with a boolean literal (`true` or `false`)
   * and removes the unreachable branch.
   *
   * @param flag Name of the feature flag to check
   * @returns `true` if the flag was passed with `--feature=FLAG`, `false` otherwise
   *
   * @example
   * ```ts
   * import { feature } from "bun:bundle";
   *
   * // With --feature=DEBUG, this becomes: if (true) { ... }
   * // Without --feature=DEBUG, this becomes: if (false) { ... }
   * if (feature("DEBUG")) {
   *   console.log("Debug mode enabled");
   * }
   * ```
   */
  function feature(flag: Registry extends { features: infer Features extends string } ? Features : string): boolean;

  /**
   * Validates `value` against the TypeScript type `T` and returns a copy of it typed as `T`. If `value` doesn't match,
   * throws a `TypeError` whose `issues` property lists every mismatch. `JSON.parse<T>(text)` does the same for JSON
   * text.
   *
   * Objects and arrays that `T` describes are copied, and `value` is never modified. The copy has the same keys in the
   * same order, including properties that `T` doesn't declare.
   *
   * Bun replaces each call with the checks for `T` at build time and removes the import, so `validate` doesn't exist at
   * run time. Import it by name and call it with a type argument. It can't be re-exported, assigned or passed as an
   * argument.
   *
   * Only `bun compile`, `bun run --aot` and `bun test --aot` validate. Everywhere else, importing `validate` is an
   * error and `JSON.parse<T>(text)` is `JSON.parse(text)`.
   *
   * ```ts
   * import { validate } from "bun:bundle";
   * import type { Schema } from "bun";
   * interface Login { name: string & Schema.MinLength<1>; password: string & Schema.MinLength<8> }
   * const form = await request.formData();
   * const login = validate<Login>({ name: form.get("name"), password: form.get("password") });
   * ```
   */
  function validate<T>(value: unknown): T;
}
