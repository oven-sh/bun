/**
 * The config of a `bun bake` app, in `bake.config.ts`.
 *
 * @example
 * ```ts
 * import { defineConfig } from "bun:bake";
 * import tailwind from "bun-plugin-tailwind";
 *
 * export default defineConfig({
 *   plugins: [tailwind],
 * });
 * ```
 */
declare module "bun:bake" {
  /** The default export of `bake.config.ts`. */
  export interface Config {
    /** Build plugins. `bun bake` runs them on the pages and the files they import. */
    plugins?: import("bun").BunPlugin[];
  }

  /** What a config function gets. */
  export interface ConfigEnv {
    /** `"development"` in `bun bake`. */
    mode: "development" | "production";
  }

  /** Returns `config` as it is. It exists for types. */
  export function defineConfig<T extends Config | ((env: ConfigEnv) => Config | Promise<Config>)>(config: T): T;
}
