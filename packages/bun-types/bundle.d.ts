/**
 * The `bun:bundle` module provides compile-time utilities for dead-code elimination.
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
}
