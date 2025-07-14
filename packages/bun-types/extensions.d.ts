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
  var contents: Bun.BunLockFile;
  export = contents;
}

declare module "*.html" {
  var contents: Bun.HTMLBundle;
  export = contents;
}
