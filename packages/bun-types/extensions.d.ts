declare module "*.txt" {
  var text: string;
  export = text;
}

declare module "*.toml" {
  var contents: any;
  export = contents;
}

declare module "*.yaml" {
  var contents: any;
  export = contents;
}

declare module "*.yml" {
  var contents: any;
  export = contents;
}

declare module "*.jsonc" {
  var contents: any;
  export = contents;
}

declare module "*.json5" {
  var contents: any;
  export = contents;
}

/**
 * A C source file. Bun compiles it and exports each of its non-`static` functions. Integers up to
 * 32 bits, `float` and `double` are passed as numbers, 64-bit integers as bigints, and pointers as
 * numbers, `TypedArray`s or `null`.
 */
declare module "*.c";

declare module "*.xml" {
  var contents: import("bun").XML.Document;
  export = contents;
}

declare module "*/bun.lock" {
  var contents: import("bun").BunLockFile;
  export = contents;
}

declare module "*.html" {
  var contents: import("bun").HTMLBundle;

  export = contents;
}
