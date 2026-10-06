// Bun picks the loader from the `type` import attribute, so a file with any
// extension can be imported as text, TOML, a SQLite database, and so on:
//
//   import template from "./template.html" with { type: "text" };
//
// TypeScript 7.1 resolves an import that has attributes against the pattern
// ambient modules below before it looks at the file extension. Older compilers
// reject this syntax even with `skipLibCheck`, so this file lives under ts7.1/
// and is only reachable through `typesVersions` in package.json.
//
// `type: "json"` and `type: "macro"` are absent on purpose. A matching
// declaration here wins over the real file, so `import pkg from
// "./package.json" with { type: "json" }` would become `any` instead of
// keeping the precise type of the JSON file. The same goes for a macro's
// exports.

declare module "*" with { type: "text" } {
  /**
   * The contents of the file as a string.
   */
  var text: string;
  export = text;
}

declare module "*" with { type: "file" } {
  /**
   * The path to the file. At runtime this is the absolute path on disk. In a
   * bundle it is the path of the copied asset, prefixed with `publicPath`.
   */
  var path: string;
  export = path;
}

declare module "*" with { type: "md" } {
  /**
   * The Markdown rendered to HTML.
   */
  var html: string;
  export = html;
}

declare module "*" with { type: "markdown" } {
  /**
   * The Markdown rendered to HTML.
   */
  var html: string;
  export = html;
}

declare module "*" with { type: "toml" } {
  var contents: any;
  export = contents;
}

declare module "*" with { type: "yaml" } {
  var contents: any;
  export = contents;
}

declare module "*" with { type: "jsonc" } {
  var contents: any;
  export = contents;
}

declare module "*" with { type: "json5" } {
  var contents: any;
  export = contents;
}

declare module "*" with { type: "xml" } {
  var contents: import("bun").XML.Document;
  export = contents;
}

declare module "*" with { type: "sqlite" } {
  /**
   * The database, opened with `bun:sqlite`. `embed: "true"` bundles the
   * database file into the output and resolves here as well.
   */
  var db: import("bun:sqlite").Database;
  export = db;
}

declare module "*" with { type: "html" } {
  var contents: import("bun").HTMLBundle;
  export = contents;
}
