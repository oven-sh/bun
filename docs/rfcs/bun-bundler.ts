/**
 * Bundler API
 *
 * This is a proposal for the JavaScript API for Bun's native bundler.
 */

import { BunPlugin, FileBlob } from "bun";

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
export type LogLevel = "verbose" | "debug" | "info" | "warning" | "error" | "silent";
export type Charset = "ascii" | "utf8";

export interface BundlerOptions {
  // currently this only accepts a Loader string
  // change: set an ext->loader map
  loader?: { [k in string]: Loader };

  // rename `platform` to `target`
  target?:
    | Target
    | {
        name: Target; // e.g. 'node', 'browser'
        // instead of esbuild's `target`
        version?: string; // e.g. '18', 'es2020'
        // low priority
        supported?: Record<string, boolean>;
      };

  // currently accepts a tsconfig as stringified JSON or an object
  // IMO this should accept a file path to a tsconfig.json file instead
  // or at least in addition
  // that's what most people are used to in config files
  tsconfig?: string;

  // I don't know what this is
  allowBunRuntime?: boolean;

  ////////////////////////////////
  // no changes below this line //
  ////////////////////////////////
  macro?: MacroMap;
  autoImportJSX?: boolean;
  trimUnusedImports?: boolean;
  jsxOptimizationInline?: boolean;
  inline?: boolean;

  sourcemap?:
    | boolean
    | {
        root?: string;
        inline?: boolean;
        external?: boolean;

        // probably unnecessary
        content?: boolean;
      };

  format?:
    | Format
    | {
        type: "iife";
        globalName?: string;
      };

  logging?: {
    color?: boolean;
    level?: LogLevel;
    // extremely low priority
    limit?: number;
    override?: Record<string, LogLevel>;
  };

  // removed: mangleProps, reserveProps, mangleQuoted, mangleCache

  /** Documentation: https://esbuild.github.io/api/#minify */
  minify?:
    | boolean
    | {
        whitespace?: boolean;
        identifiers?: boolean;
        syntax?: boolean;
      };

  treeShaking?:
    | boolean
    | {
        imports?: boolean;
        code?: boolean;
        // whether to believe @__PURE__
        // I hate this
        pure?: boolean;
        // whether to believe package.json sideEffects
        sideEffects?: boolean;
      };

  jsx?:
    | JsxTransform
    | {
        transform?: JsxTransform;
        factory?: string;
        fragment?: string;
        importSource?: string;
        development?: boolean;
        sideEffects?: boolean;
      };

  /**
   * Low priority
   * */
  legalComments?: "none" | "inline" | "eof" | "linked" | "external";
  charset?: Charset;
}

// `.build(options: BuildOptions)`
// can override everything specified in Bundler options
interface BuildOptions extends BundlerOptions {
  bundle?: boolean; // default true
  splitting?: boolean;
  plugins?: BunPlugin[];
  cwd?: string;
  watch?: boolean;

  // dropped: preserveSymlinks
  // defer to tsconfig for this

  // whether to parse manifest after build
  manifest?: boolean;

  // inputs
  entrypoints: string[];
  rootDir?: string; // equiv. outbase

  memory?: boolean;

  // no outfile; it can be specified with `outdir` and `outnames`
  write?:
    | string
    | {
        dir?: string;
        overwrite?: boolean;
      };

  naming?: {
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
    // mark all bare identifiers as external
    bare?: boolean;
  };

  transform?: {
    define?: Record<string, string>;
    inject?: string[];
    imports?: {
      rename?: Record<string, string>;
    };
    exports?: {
      pick?: string[];
      omit?: string[];
      rename?: Record<string, string>;
      // replace definition with a code snippet?
      // probably not workable
      stub?: Record<string, string>;
    };
  };

  // this should probably use the same resolution algorithm as Bun's runtime
  resolve?: {
    conditions?: string[];
    // unclear if either of these should be customizable 👇
    mainFields?: string[];
    extensions?: string[];
  };

  /** Documentation: https://esbuild.github.io/api/#public-path */
  publicPath?: string;

  /** Documentation: https://esbuild.github.io/api/#banner */
  inject?: Array<{
    position: "start" | "end";
    target: "entry" | "chunk" | "all";
    content: string;
    extensions: string[];
  }>;
}

type BuildResult = {
  manifest: object;
  results: Record<string, Buffer>;
};

declare class Bundler {
  constructor(options: BundlerOptions);
  build: (options: BuildOptions) => Promise<BuildResult>;
  buildSync: (options: BuildOptions) => BuildResult;
  handle: (
    req: Request,
    options: { prefix?: string }, // prefix to remove from req.url
  ) => Promise<FileBlob | null>;
  rebuild(): Promise<void>;
}

const bundler = new Bundler({}).build({
  entrypoints: ["index.js"],
  write: process.cwd() + "/build",
});
