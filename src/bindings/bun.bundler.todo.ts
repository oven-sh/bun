// TODO: bindings generator is missing alot
import { ZigEnum, dictionary, oneOf, t, Func, fn } from "../codegen/bindgen-lib";

export const MinifyConfig = dictionary({
  syntax: t.boolean.default(false),
  whitespace: t.boolean.default(false),
  identifiers: t.boolean.default(false),
});

export const ExperimentalCssConfig = dictionary({
  chunking: t.boolean.default(false),
});

export const Target = ZigEnum("options.zig", "Target");
export const SourceMapOption = ZigEnum("options.zig", "SourceMapOption");
export const PackagesOption = ZigEnum("options.zig", "PackagesOption");
export const Format = ZigEnum("options.zig", "Format");
export const Loader = ZigEnum("options.zig", "Loader");

export const BuildConfig = dictionary({
  plugins: t.sequence(t.any).default([]),
  experimentalCss: oneOf(t.boolean, ExperimentalCssConfig).default(false),
  macros: t.boolean.default(true),
  bytecode: t.boolean.default(false),
  target: Target.default("browser"),
  outdir: t.WTF8String,
  banner: t.WTF8String,
  footer: t.WTF8String,
  sourcemap: oneOf(t.boolean, SourceMapOption).default(false),
  packages: PackagesOption.default("bundle"),
  format: Format,
  splitting: t.boolean.default(false),
  minify: oneOf(t.boolean, MinifyConfig).default(false),
  // TODO: alternate casing
  entrypoints: t.sequence(t.WTF8String).required,
  emitDCEAnnotations: t.boolean,
  ignoreDCEAnnotations: t.boolean,
  conditions: t.sequence(t.WTF8String),
  root: t.WTF8String,
  external: t.sequence(t.WTF8String),
  drop: t.sequence(t.WTF8String),
  publicPath: t.WTF8String,
  naming: oneOf(
    t.WTF8String,
    dictionary({
      entry: t.WTF8String,
      chunk: t.WTF8String,
      asset: t.WTF8String,
    }),
  ),
  define: t.record(t.WTF8String),
  loader: t.record(Loader),
});

fn({
  name: "build",
  args: {
    config: BuildConfig,
  },
  ret: t.any,
});
