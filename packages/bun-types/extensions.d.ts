declare module "*.txt" {
  var text: string;
  export = text;
}

// Bun exports each top-level key of a parsed data file by name, beside the
// default export of the whole value. A declaration cannot list the keys of a
// file it has not read, and `export =` of a value without declared properties
// rejects every named import (TS2305). A declaration with no body makes
// TypeScript type the default import and every named import as `any`.

/** The default import and every named import are `any`. For exact types, put `config.toml.d.ts` beside `config.toml`. */
declare module "*.toml";

/** The default import and every named import are `any`. For exact types, put `config.yaml.d.ts` beside `config.yaml`. */
declare module "*.yaml";

/** The default import and every named import are `any`. For exact types, put `config.yml.d.ts` beside `config.yml`. */
declare module "*.yml";

/** The default import and every named import are `any`. For exact types, put `config.jsonc.d.ts` beside `config.jsonc`. */
declare module "*.jsonc";

/** The default import and every named import are `any`. For exact types, put `config.json5.d.ts` beside `config.json5`. */
declare module "*.json5";

// TypeScript reads "no body" from the first declaration of a pattern, and
// `export =` from whichever declaration has it. The bodiless declaration has
// to stay first: then the root element is importable by name, as `any`, and
// the default import is still an `XML.Document`. In the other order every
// named import is TS2305.
/** The default import is an `XML.Document`. The root element, imported by name, is `any`. */
declare module "*.xml";
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
