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

declare module "*/bun.lock" {
  var contents: import("bun").BunLockFile;
  export = contents;
}

declare module "*.html" {
  var contents: import("bun").HTMLBundle;

  export = contents;
}

declare module "*.csv" {
  export var data: Record<string, string>[];
  export default data;
  export var rows: number;
  export var columns: number;
  export var errors:
    | {
        line: number;
        text: string;
      }[]
    | undefined;
  export var comments:
    | {
        line: number;
        text: string;
      }[]
    | undefined;
}

declare module "*.csv?header=false" {
  export var data: string[][];
  export default data;
  export var rows: number;
  export var columns: number;
  export var errors:
    | {
        line: number;
        text: string;
      }[]
    | undefined;
  export var comments:
    | {
        line: number;
        text: string;
      }[]
    | undefined;
}

declare module "*.tsv" {
  export var data: Record<string, string>[];
  export default data;
  export var rows: number;
  export var columns: number;
  export var errors:
    | {
        line: number;
        text: string;
      }[]
    | undefined;
  export var comments:
    | {
        line: number;
        text: string;
      }[]
    | undefined;
}

declare module "*.tsv?header=false" {
  export var data: string[][];
  export default data;
  export var rows: number;
  export var columns: number;
  export var errors:
    | {
        line: number;
        text: string;
      }[]
    | undefined;
  export var comments:
    | {
        line: number;
        text: string;
      }[]
    | undefined;
}
