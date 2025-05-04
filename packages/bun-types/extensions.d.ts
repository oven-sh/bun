declare module "*.txt" {
  var text: string;
  export = text;
}

declare module "*.toml" {
  var contents: any;
  export = contents;
}

declare module "*.jsonc" {
  var contents: any;
  export = contents;
}

declare module "*/bun.lock" {
  var contents: import("bun").BunLockFile;
  export = contents;
}

declare module "*.html" {
  // In Bun v1.2, this might change to Bun.HTMLBundle
  var contents: any;
  export = contents;
}

declare module "*.csv" {
  var contents: Record<string, string>[];
  export = contents;
}

declare module "*.csv?no_header" {
  var contents: string[][];
  export = contents;
}

declare module "*.tsv" {
  var contents: Record<string, string>[];
  export = contents;
}

declare module "*.tsv?no_header" {
  var contents: string[][];
  export = contents;
}
