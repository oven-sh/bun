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

declare module "*.xml" {
  var contents: any;
  export = contents;
}

declare module "*.md" {
  var html: string;
  export = html;
}

declare module "*.markdown" {
  var html: string;
  export = html;
}

declare module "*/bun.lock" {
  var contents: import("bun").BunLockFile;
  export = contents;
}

declare module "*.html" {
  var contents: import("bun").HTMLBundle;

  export = contents;
}
