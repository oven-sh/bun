/**
 * Bundler API
 *
 * This is a proposal for the JavaScript API for Bun's native bundler.
 */

import { FileBlob } from "bun";
type BunPlugin = Parameters<(typeof Bun)["plugin"]>[0];
export type JavaScriptLoader = "jsx" | "js" | "ts" | "tsx";
export type MacroMap = Record<string, Record<string, string>>;
export type Target = "bun" | "browser" | "node" | "neutral";
export type Format = "iife" | "cjs" | "esm";
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

export interface BuildConfig {
  name?: string; // default "default"
  bundle?: boolean; // default true
  outdir?: string;
  splitting?: boolean;
  plugins?: BunPlugin[];
  cwd?: string;
  watch?: boolean;

  // dropped: preserveSymlinks
  // defer to tsconfig for this

  // whether to parse manifest after build
  manifest?: boolean;

  // inputs
  entrypoints?: string[];
  root?: string; // equiv. outbase

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
  external?: {
    // exclude matching identifiers
    match?: (string | RegExp)[];
  };

  // transform options only apply to entrypoints
  transform?: {
    imports?: {
      rename?: Record<string, string>;
    };
    exports?: {
      pick?: string[];
      omit?: string[];
      rename?: Record<string, string>;
    };
  };

  resolve?: {
    conditions?: string[];
    // unclear if either of these should be customizable 👇
    mainFields?: string[];
    extensions?: string[];
  };

  publicPath?: string;
  // handle build errors
  catch?(errors: BundlerError[]): void;

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
    | boolean
    | {
        root?: string;
        inline?: boolean;
        external?: boolean;

        // probably unnecessary
        content?: boolean;
      };

  format?: Format;

  // removed: logging, mangleProps, reserveProps, mangleQuoted, mangleCache

  /** Documentation: https://esbuild.github.io/api/#minify */
  minify?:
    | boolean
    | {
        whitespace?: boolean;
        identifiers?: boolean;
        syntax?: boolean;
      };

  treeShaking?: boolean;

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

  outputs: {
    [path: string]: {
      type: "chunk" | "entry-point" | "asset";

      // low priority
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

export type BuildResult<T> = {
  // only exists if `manifest` is true
  manifest?: BuildManifest;
  // per-build context that can be written to by plugins
  context?: object;
  outputs: { path: string; result: T }[];
};

export type LazyBuildResult = {
  then(cb: (context: any) => BuildOptions): LazyBuildResult;
  run(): Promise<BuildResult<Blob>>;
  write(dir: string): Promise<BuildResult<FileBlob>>;
};
