/**
 * Bundler API
 *
 * This is a proposal for the JavaScript API for Bun's native bundler.
 */

import { FileBlob } from "bun";
import { Log } from "./bun-build-logs";
type BunPlugin = Parameters<(typeof Bun)["plugin"]>[0];
export type JavaScriptLoader = "jsx" | "js" | "ts" | "tsx";
export type MacroMap = Record<string, Record<string, string>>;
export type Target = "bun" | "browser" | "node" | "neutral";
export type ModuleFormat = "iife" | "cjs" | "esm";
export type JsxTransform = "transform" | "preserve" | "automatic";
export type Loader =
  | "base64"
  | "binary"
  | "copy"
  | "css"
  | "dataurl"
  | "default"
  | "empty"
  | "file"
  | "js"
  | "json"
  | "jsx"
  | "text"
  | "ts"
  | "tsx";
export type ImportKind =
  | "entry-point"
  | "import-statement"
  | "require-call"
  | "dynamic-import"
  | "require-resolve"
  | "import-rule"
  | "url-token";
export type LogLevel = "verbose" | "debug" | "info" | "warning" | "error" | "silent";
export type Charset = "ascii" | "utf8";

type BundlerError = {
  file: string;
  error: Error;
};

export interface BuildConfig extends BundlerConfig {
  entrypoints: string[];
  outdir: string;
  root?: string; // equiv. outbase
  watch?: boolean;
}

export interface BundlerConfig {
  label?: string; // default "default"
  bundle?: boolean; // default true
  splitting?: boolean;
  plugins?: BunPlugin[];

  // dropped: preserveSymlinks. defer to tsconfig for this.

  // whether to parse manifest after build
  manifest?: boolean;

  naming?:
    | string
    | {
        /** Documentation: https://esbuild.github.io/api/#entry-names */
        entry?: string;
        /** Documentation: https://esbuild.github.io/api/#chunk-names */
        chunk?: string;
        /** Documentation: https://esbuild.github.io/api/#asset-names */
        asset?: string;
        extensions?: { [ext: string]: string };
      };

  /** Documentation: https://esbuild.github.io/api/#external */
  external?: Array<string | RegExp>;

  // set environment variables
  env?: Record<string, string>;

  // transform options only apply to entrypoints
  imports?: {
    rename?: Record<string, string>;
  };
  exports?: {
    pick?: string[];
    omit?: string[];
    rename?: Record<string, string>;
  };

  // export conditions in priority order
  conditions?: string[];

  origin?: string; // e.g. http://mydomain.com

  // in Bun.Transpiler this only accepts a Loader string
  // change: set an ext->loader map
  loader?: { [k in string]: Loader };

  // rename `platform` to `target`
  target?: Target;

  // path to a tsconfig.json file
  // or a parsed object
  // passing in a stringified json is weird
  tsconfig?: string | object;

  // from Bun.Transpiler API
  macro?: MacroMap;

  sourcemap?:
    | "none"
    | "inline"
    | "external"
    | {
        root?: string;
        inline?: boolean;
        external?: boolean;

        // probably unnecessary
        content?: boolean;
      };

  module?: ModuleFormat;

  // removed: logging, mangleProps, reserveProps, mangleQuoted, mangleCache

  /** Documentation: https://esbuild.github.io/api/#minify */
  minify?:
    | boolean
    | {
        whitespace?: boolean;
        identifiers?: boolean;
        syntax?: boolean;
      };

  treeshaking?: boolean;

  jsx?:
    | JsxTransform
    | {
        transform?: JsxTransform;
        factory?: string;
        fragment?: string;
        importSource?: string;
        development?: boolean;
        sideEffects?: boolean;
        inline?: boolean;
        optimizeReact?: boolean;
        autoImport?: boolean;
      };

  charset?: Charset;
}

// copied from esbuild
export type BuildManifest = {
  inputs: {
    [path: string]: {
      output: {
        path: string;
      };
      imports: {
        path: string;
        kind: ImportKind;
        external?: boolean;
      }[];
    };
  };

  // less important than `inputs`
  outputs: {
    [path: string]: {
      type: "chunk" | "entry-point" | "asset";
      inputs: {
        [path: string]: {
          bytesInOutput: number;
        };
      };
      imports: {
        path: string;
        kind: ImportKind | "file-loader";
        external?: boolean;
      }[];
      exports: string[];
    };
  };
};
